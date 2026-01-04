const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");

dotenv.config();

/* ================= ENV VALIDATION ================= */

if (!process.env.OCR_API_KEY) {
  throw new Error("OCR_API_KEY missing");
}
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY missing");
}

/* ================= APP SETUP ================= */

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const upload = multer({ storage: multer.memoryStorage() });

/* ================= PROMPTS ================= */

const buildAccountMetaPrompt = (text) => `
You are a strict JSON extractor for bank statements.

CRITICAL RULES:
1. Output ONLY valid JSON - no markdown, no explanations
2. Look for ALL account numbers on this page
3. If multiple accounts exist, return the FIRST/PRIMARY account shown
4. Account numbers often appear after "Account Number", "A/c No", or account type labels

Common account number formats:
- XXX-XXXXX-X (e.g., 803-01867-3)
- XX-XXXXXP (e.g., 26-00803P)
- XXXXXXXXXXXX (10-18 digits)

OUTPUT FORMAT:
{
  "bankName": "",
  "accountHolderName": "",
  "accountNumber": "",
  "accountType": "",
  "currency": "",
  "statementStartDate": "",
  "statementEndDate": "",
  "additionalAccounts": []
}

If you see multiple account numbers, list them in "additionalAccounts" array.

TEXT:
"""
${text}
"""
`;

const buildTransactionPrompt = (text) => `
You are a bank statement transaction normalizer.

IMPORTANT:
The OCR text has broken columns and misaligned values.

RULES:
- Output ONLY valid JSON
- No markdown
- No explanations
- Preserve transaction order
- Do NOT invent rows
- Do NOT invent values
- Do NOT calculate balances
- If unsure, leave fields empty

OUTPUT:
{
  "transactions": [
    {
      "date": "",
      "description": "",
      "debitAmount": "",
      "creditAmount": "",
      "runningBalance": ""
    }
  ]
}

OCR TEXT:
"""
${text}
"""
`;

/* ================= HELPERS ================= */

const callLLM = async (prompt, label) => {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const modelId = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    const response = await axios.post(
      endpoint,
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 120000,
      }
    );

    // Extract text from Gemini response
    const candidates = response.data?.candidates;
    if (candidates && candidates[0]?.content?.parts?.[0]?.text) {
      return candidates[0].content.parts[0].text;
    }

    throw new Error("Unknown Gemini response format");
  } catch (err) {
    if (err.response?.status === 400) {
      throw new Error(
        `Gemini API error: ${
          err.response?.data?.error?.message || "Bad request"
        }`
      );
    }
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw new Error(
        "Gemini authentication failed. Check GEMINI_API_KEY in .env"
      );
    }
    if (err.response?.status === 429) {
      throw new Error("Gemini rate limit exceeded. Please wait and try again.");
    }
    throw new Error(`${label} Gemini call failed: ${err.message}`);
  }
};

const parseLLMJSON = (raw, label) => {
  if (!raw) throw new Error(`${label}: empty response`);

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error(`${label}: invalid JSON`);
  }

  let jsonStr = raw.slice(start, end + 1);

  // Clean up common LLM JSON issues
  jsonStr = jsonStr
    .replace(/,\s*}/g, "}") // Remove trailing commas before }
    .replace(/,\s*]/g, "]") // Remove trailing commas before ]
    .replace(/[\r\n]+/g, " ") // Replace newlines with spaces
    .replace(/\s+/g, " ") // Normalize whitespace
    .replace(/"\s*,\s*,/g, '",') // Fix double commas
    .replace(/,\s*,/g, ",") // Remove duplicate commas
    .replace(/\[\s*,/g, "[") // Remove leading comma in arrays
    .replace(/{\s*,/g, "{"); // Remove leading comma in objects

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Try to fix common issues and retry
    try {
      // Sometimes LLM outputs incomplete JSON, try to fix arrays
      if (jsonStr.includes('"transactions"')) {
        // Find the transactions array and ensure it's properly closed
        const txnStart = jsonStr.indexOf('"transactions"');
        if (txnStart !== -1) {
          const arrayStart = jsonStr.indexOf("[", txnStart);
          if (arrayStart !== -1) {
            let depth = 0;
            let lastValidPos = arrayStart;
            for (let i = arrayStart; i < jsonStr.length; i++) {
              if (jsonStr[i] === "[") depth++;
              if (jsonStr[i] === "]") depth--;
              if (depth === 0) {
                lastValidPos = i;
                break;
              }
              if (jsonStr[i] === "}" && depth === 1) {
                lastValidPos = i;
              }
            }
            // Reconstruct valid JSON
            const fixedJson = jsonStr.substring(0, lastValidPos + 1) + "]}";
            return JSON.parse(fixedJson);
          }
        }
      }
    } catch (e2) {
      // Ignore retry errors
    }

    console.error(`${label}: JSON parse error - ${e.message}`);
    console.error(
      `Raw JSON (first 300 chars): ${jsonStr.substring(0, 300)}...`
    );
    throw new Error(`${label}: invalid JSON - ${e.message}`);
  }
};

const splitPdfIntoPages = async (buffer) => {
  const src = await PDFDocument.load(buffer);
  const pages = [];

  for (let i = 0; i < src.getPageCount(); i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    pages.push(Buffer.from(await doc.save()));
  }

  return pages;
};

const extractTransactionBlock = (text) => {
  // Try multiple common patterns for transaction sections
  const patterns = [
    "Statement of Transactions",
    "Transaction Details",
    "Transaction History",
    "Account Activity",
    "Transactions",
    "Date Description",
    "Date Particulars",
    "Value Date",
  ];

  for (const pattern of patterns) {
    const idx = text.toLowerCase().indexOf(pattern.toLowerCase());
    if (idx !== -1) {
      return text.slice(idx);
    }
  }

  // If no pattern found, return the full text for LLM to parse
  // This handles cases where transactions start without a header
  return text;
};

// Extract ALL account numbers from OCR text using regex patterns
const extractAllAccountNumbersFromText = (text) => {
  const accountNumbers = new Set();

  // Common patterns for account numbers in bank statements
  const patterns = [
    // Account patterns like XXX-XXXXX-X (e.g., 803-01867-3)
    /\b(\d{3}-\d{5}-\d)\b/g,
    // Account patterns like XXX-XXXXX-X with letters
    /\b(\d{3}-\d{5}-[A-Z0-9])\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) {
        accountNumbers.add(match[1]);
      }
    }
  }

  return Array.from(accountNumbers);
};

// Extract single account number from OCR text using regex patterns
const extractAccountNumberFromText = (text) => {
  const allAccounts = extractAllAccountNumbersFromText(text);
  return allAccounts.length > 0 ? allAccounts[0] : null;
};

/* ================= API ================= */

app.post("/parse-bank-statement", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File missing" });
    }

    const pages = await splitPdfIntoPages(req.file.buffer);
    const accounts = {};
    let activeAccountNumber = null;

    for (let i = 0; i < pages.length; i++) {
      try {
        /* ---------- OCR ---------- */

        const form = new FormData();
        form.append("file", pages[i], {
          filename: `page-${i + 1}.pdf`,
          contentType: "application/pdf",
        });
        form.append("language", "eng");
        form.append("isOverlayRequired", "false");
        form.append("OCREngine", "2");

        const ocrRes = await axios.post(
          "https://api.ocr.space/parse/image",
          form,
          {
            headers: {
              ...form.getHeaders(),
              apikey: process.env.OCR_API_KEY,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 160000,
          }
        );

        if (ocrRes.data.IsErroredOnProcessing) {
          console.warn(
            `OCR failed on page ${i + 1}: ${
              ocrRes.data.ErrorMessage || "Unknown OCR error"
            }`
          );
          continue;
        }

        const pageText =
          ocrRes.data.ParsedResults?.map((r) => r.ParsedText)
            .join("\n")
            .trim() || "";

        if (!pageText) continue;

        /* ---------- METADATA ---------- */

        let meta = {
          bankName: "",
          accountHolderName: "",
          accountNumber: "",
          accountType: "",
          currency: "",
          statementStartDate: "",
          statementEndDate: "",
          additionalAccounts: [],
        };

        try {
          const metaRaw = await callLLM(
            buildAccountMetaPrompt(pageText),
            `Metadata page ${i + 1}`
          );
          const parsedMeta = parseLLMJSON(metaRaw, `Metadata page ${i + 1}`);
          meta = { ...meta, ...parsedMeta };
        } catch (metaErr) {
          console.warn(
            `Metadata extraction failed for page ${i + 1}: ${metaErr.message}`
          );
        }

        // Debug: write to file
        fs.appendFileSync(
          "debug.log",
          `\nPage ${i + 1} metadata: ${JSON.stringify(meta, null, 2)}\n`
        );

        // Try to get account number - prefer regex (more reliable) over LLM
        const regexAccounts = extractAllAccountNumbersFromText(pageText);
        let accountNumber =
          regexAccounts[0] || meta.accountNumber || activeAccountNumber;

        fs.appendFileSync(
          "debug.log",
          `Page ${i + 1} account number resolved: ${accountNumber}\n`
        );

        // Find ALL account numbers on this page using regex
        fs.appendFileSync(
          "debug.log",
          `Page ${i + 1} all accounts found: ${JSON.stringify(regexAccounts)}\n`
        );

        // Create entries for all accounts found on this page
        for (const acctNum of regexAccounts) {
          if (!accounts[acctNum]) {
            accounts[acctNum] = {
              accountNumber: acctNum,
              bankName: meta.bankName || "",
              accountHolderName: meta.accountHolderName || "",
              accountType: "",
              currency: meta.currency || "",
              statementStartDate: meta.statementStartDate || "",
              statementEndDate: meta.statementEndDate || "",
              transactions: [],
            };
          }
        }

        // Handle additional accounts from LLM response (only if they match our pattern)
        if (meta.additionalAccounts && Array.isArray(meta.additionalAccounts)) {
          for (const addlAcct of meta.additionalAccounts) {
            // Only add if it matches the XXX-XXXXX-X pattern
            if (
              addlAcct &&
              /^\d{3}-\d{5}-\d$/.test(addlAcct) &&
              !accounts[addlAcct]
            ) {
              accounts[addlAcct] = {
                accountNumber: addlAcct,
                bankName: meta.bankName || "",
                accountHolderName: meta.accountHolderName || "",
                accountType: "",
                currency: meta.currency || "",
                statementStartDate: meta.statementStartDate || "",
                statementEndDate: meta.statementEndDate || "",
                transactions: [],
              };
              fs.appendFileSync(
                "debug.log",
                `Page ${i + 1} additional account found: ${addlAcct}\n`
              );
            }
          }
        }

        // If still no account number, generate a temporary one based on bank name
        if (!accountNumber) {
          accountNumber = `UNKNOWN-${meta.bankName || "BANK"}-${Date.now()}`;
          console.log(
            `Warning: Could not extract account number, using temporary: ${accountNumber}`
          );
        }

        activeAccountNumber = accountNumber;

        if (!accounts[accountNumber]) {
          accounts[accountNumber] = {
            accountNumber,
            bankName: meta.bankName || "",
            accountHolderName: meta.accountHolderName || "",
            accountType: meta.accountType || "",
            currency: meta.currency || "",
            statementStartDate: meta.statementStartDate || "",
            statementEndDate: meta.statementEndDate || "",
            transactions: [],
          };
        }

        /* ---------- TRANSACTIONS ---------- */

        const txnText = extractTransactionBlock(pageText);
        if (!txnText) continue;

        try {
          const txnRaw = await callLLM(
            buildTransactionPrompt(txnText),
            `Transactions page ${i + 1}`
          );
          const txns = parseLLMJSON(txnRaw, `Transactions page ${i + 1}`);

          if (txns && Array.isArray(txns.transactions)) {
            accounts[accountNumber].transactions.push(...txns.transactions);
          }
        } catch (txnErr) {
          console.warn(
            `Transaction extraction failed for page ${i + 1}: ${txnErr.message}`
          );
        }
      } catch (pageErr) {
        console.warn(`Failed to process page ${i + 1}: ${pageErr.message}`);
        // Continue to next page instead of failing entire request
      }
    }

    res.json({
      success: true,
      fileName: req.file.originalname,
      accounts: Object.values(accounts),
    });
  } catch (err) {
    console.error("Error details:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});
