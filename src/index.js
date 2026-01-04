const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const { PDFDocument } = require("pdf-lib");

dotenv.config();

/* ================= ENV VALIDATION ================= */

if (!process.env.OCR_API_KEY) {
  throw new Error("OCR_API_KEY missing");
}
if (!process.env.LLM_URL) {
  throw new Error("LLM_URL missing");
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

RULES:
- Output ONLY valid JSON
- No markdown, no explanations
- Do NOT guess values
- Empty string if missing
- Look for account number patterns like:
  - "Account No", "A/c No", "Account Number"
  - Numbers with format: XXXXXXXXXXXX (10-18 digits)
  - Numbers after "Savings A/c", "Current A/c"

OUTPUT FORMAT:
{
  "bankName": "",
  "accountHolderName": "",
  "accountNumber": "",
  "accountType": "",
  "currency": "",
  "statementStartDate": "",
  "statementEndDate": ""
}

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

const extractLLMText = (res) => {
  if (res.data?.response) return res.data.response;
  if (res.data?.choices?.[0]?.text) return res.data.choices[0].text;
  throw new Error("Unknown LLM response format");
};

const callLLM = async (prompt, label) => {
  try {
    const response = await axios.post(
      process.env.LLM_URL,
      {
        model: "llama3",
        prompt,
        stream: false,
      }
      // { timeout: 120000 }
    );
    return extractLLMText(response);
  } catch (err) {
    if (err.code === "ECONNREFUSED") {
      throw new Error(
        `LLM server not running. Start Ollama with: ollama serve`
      );
    }
    throw new Error(`${label} LLM call failed: ${err.message}`);
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
    .replace(/\s+/g, " "); // Normalize whitespace

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`${label}: JSON parse error - ${e.message}`);
    console.error(`Raw JSON: ${jsonStr.substring(0, 200)}...`);
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

// Extract account number from OCR text using regex patterns
const extractAccountNumberFromText = (text) => {
  // Common patterns for account numbers in bank statements
  const patterns = [
    // "Account No: 123456789012" or "A/c No: 123456789012"
    /(?:account\s*(?:no|number|#)|a\/c\s*(?:no|number|#))\s*[:\-]?\s*(\d{8,18})/i,
    // "Savings A/c 123456789012" or "Current A/c 123456789012"
    /(?:savings|current|checking)\s*a\/c\s*[:\-]?\s*(\d{8,18})/i,
    // "Account: 123456789012"
    /account\s*[:\-]\s*(\d{8,18})/i,
    // Standalone long number that looks like account number (10-18 digits)
    /\b(\d{10,18})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
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
          timeout: 60000,
        }
      );

      if (ocrRes.data.IsErroredOnProcessing) {
        throw new Error(
          `OCR failed on page ${i + 1}: ${
            ocrRes.data.ErrorMessage || "Unknown OCR error"
          }`
        );
      }

      const pageText =
        ocrRes.data.ParsedResults?.map((r) => r.ParsedText)
          .join("\n")
          .trim() || "";

      if (!pageText) continue;

      /* ---------- METADATA ---------- */

      const metaRaw = await callLLM(
        buildAccountMetaPrompt(pageText),
        `Metadata page ${i + 1}`
      );

      const meta = parseLLMJSON(metaRaw, `Metadata page ${i + 1}`);

      // Try to get account number from LLM, then regex fallback, then previous page
      let accountNumber =
        meta.accountNumber ||
        extractAccountNumberFromText(pageText) ||
        activeAccountNumber;

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

      const txnRaw = await callLLM(
        buildTransactionPrompt(txnText),
        `Transactions page ${i + 1}`
      );
      const txns = parseLLMJSON(txnRaw, `Transactions page ${i + 1}`);

      if (Array.isArray(txns.transactions)) {
        accounts[accountNumber].transactions.push(...txns.transactions);
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
