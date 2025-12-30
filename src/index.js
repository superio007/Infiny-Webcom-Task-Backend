const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const { PDFDocument } = require("pdf-lib");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const upload = multer({ storage: multer.memoryStorage() });

/* =====================================================
   PROMPTS
===================================================== */

const buildAccountMetaPrompt = (text) => `
You are a strict JSON extractor.

RULES:
- Output ONLY valid JSON
- No markdown, no backticks
- No explanations
- Do NOT guess
- Copy text exactly
- Empty string if missing

OUTPUT:
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
You are a JSON extraction engine.

RULES:
- Output ONLY JSON
- No markdown, no explanations
- Do NOT calculate balances
- Copy values EXACTLY as seen
- Only ONE of debit or credit per row
- Extract AT MOST 3 transactions

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

TEXT:
"""
${text}
"""
`;

/* =====================================================
   HELPERS
===================================================== */

const sanitizeAndParseJSON = (raw, label) => {
  if (!raw) throw new Error(`${label}: empty LLM response`);

  let cleaned = raw.replace(/```json|```/gi, "");
  cleaned = cleaned.slice(cleaned.indexOf("{"));
  cleaned = cleaned.slice(0, cleaned.lastIndexOf("}") + 1);

  if (/\.\.\.\s*[\]}]/.test(cleaned)) {
    throw new Error(`${label}: truncated JSON`);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`${label}: JSON parse failed`);
  }
};

const mergeMeta = (prev, curr) => {
  if (!prev) return curr;
  return {
    bankName: curr.bankName || prev.bankName,
    accountHolderName: curr.accountHolderName || prev.accountHolderName,
    accountNumber: curr.accountNumber || prev.accountNumber,
    accountType: curr.accountType || prev.accountType,
    currency: curr.currency || prev.currency,
    statementStartDate: curr.statementStartDate || prev.statementStartDate,
    statementEndDate: curr.statementEndDate || prev.statementEndDate,
  };
};

const isNewAccountHeader = (curr, prev) => {
  if (!prev) return true;

  if (curr.bankName && curr.bankName !== prev.bankName) return true;
  if (curr.accountNumber && curr.accountNumber !== prev.accountNumber)
    return true;

  return false;
};

const buildAccountKey = (meta, pageIndex) => {
  if (meta.accountNumber) {
    return [
      meta.bankName?.toLowerCase(),
      meta.accountNumber?.toLowerCase(),
      meta.accountHolderName?.toLowerCase(),
    ].join("|");
  }
  return `unknown-account-${pageIndex}`;
};

/* =====================================================
   PDF → PAGES
===================================================== */

const splitPdfIntoPages = async (pdfBuffer) => {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const pages = [];

  for (let i = 0; i < srcDoc.getPageCount(); i++) {
    const newDoc = await PDFDocument.create();
    const [page] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(page);
    const bytes = await newDoc.save();
    pages.push(Buffer.from(bytes));
  }

  return pages;
};

/* =====================================================
   API ENDPOINT
===================================================== */

app.post("/parse-bank-statement", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    /* ---------- PDF → PAGES ---------- */
    const pageBuffers = await splitPdfIntoPages(req.file.buffer);

    const accountsMap = {};
    let lastKnownMeta = null;
    let currentAccountKey = null;

    /* ---------- PROCESS EACH PAGE ---------- */
    for (let i = 0; i < pageBuffers.length; i++) {
      const form = new FormData();
      form.append("file", pageBuffers[i], {
        filename: `page-${i + 1}.pdf`,
        contentType: "application/pdf",
      });

      /* ---------- OCR PER PAGE ---------- */
      const ocrRes = await axios.post(process.env.OCR_URL, form, {
        headers: form.getHeaders(),
      });

      const pageText = ocrRes?.data?.data?.text;
      if (!pageText) continue;

      /* ---------- METADATA ---------- */
      const metaLLM = await axios.post(process.env.LLM_URL, {
        model: "llama3",
        prompt: buildAccountMetaPrompt(pageText),
        stream: false,
      });

      const rawMeta = sanitizeAndParseJSON(
        metaLLM.data.response,
        `Metadata page ${i + 1}`
      );

      let pageMeta;
      if (isNewAccountHeader(rawMeta, lastKnownMeta)) {
        pageMeta = rawMeta;
      } else {
        pageMeta = mergeMeta(lastKnownMeta, rawMeta);
      }

      const accountKey = buildAccountKey(pageMeta, i);

      if (!accountsMap[accountKey]) {
        accountsMap[accountKey] = {
          meta: pageMeta,
          transactions: [],
        };
      }

      lastKnownMeta = pageMeta;
      currentAccountKey = accountKey;

      /* ---------- TRANSACTIONS ---------- */
      const txnLLM = await axios.post(process.env.LLM_URL, {
        model: "llama3",
        prompt: buildTransactionPrompt(pageText),
        stream: false,
      });

      const pageTxn = sanitizeAndParseJSON(
        txnLLM.data.response,
        `Transactions page ${i + 1}`
      );

      accountsMap[currentAccountKey].transactions.push(
        ...(pageTxn.transactions || [])
      );
    }

    /* ---------- FINAL OUTPUT ---------- */
    const accounts = Object.values(accountsMap).map((acc) => ({
      ...acc.meta,
      openingBalance: "",
      closingBalance: "",
      transactions: acc.transactions,
    }));

    res.json({
      success: true,
      data: {
        fileName: req.file.originalname,
        accounts,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
