import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const upload = multer({ storage: multer.memoryStorage() });

/* -------------------------------
   PROMPT: ACCOUNT METADATA
-------------------------------- */
const buildAccountMetaPrompt = (ocrText) => `
You are a strict JSON extractor.

RULES:
- Output ONLY valid JSON
- No markdown
- No backticks
- No explanations
- Do NOT guess
- Copy text exactly as written
- If a value is missing, use empty string

OUTPUT SCHEMA:
{
  "bankName": "",
  "accountHolderName": "",
  "accountNumber": "",
  "accountType": "",
  "currency": "",
  "statementStartDate": "",
  "statementEndDate": ""
}

OCR TEXT:
"""
${ocrText}
"""
`;

/* -------------------------------
   PROMPT: TRANSACTIONS
-------------------------------- */
const buildTransactionPrompt = (ocrText) => `
You are a JSON extraction engine.

STRICT RULES:
- Output ONLY JSON
- No backticks
- No explanations
- Do NOT calculate balances
- Copy values EXACTLY as seen
- Each transaction can have ONLY ONE of:
  - debitAmount OR creditAmount
- runningBalance ONLY if explicitly present
- If unclear, leave fields empty
- Extract AT MOST 3 transactions
- Stop extraction after 3 valid transactions

OUTPUT SCHEMA:
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
${ocrText}
"""
`;

/* -------------------------------
   SANITIZE LLM OUTPUT
-------------------------------- */
const sanitizeAndParseJSON = (raw, label) => {
  if (!raw) throw new Error(`${label}: empty LLM response`);

  let cleaned = raw.replace(/```json|```/gi, "");
  cleaned = cleaned.slice(cleaned.indexOf("{"));
  cleaned = cleaned.slice(0, cleaned.lastIndexOf("}") + 1);

  if (/\.\.\.\s*[\]}]/.test(cleaned)) {
    throw new Error(`${label}: truncated JSON`);
  }

  if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) {
    throw new Error(`${label}: not valid JSON`);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`${label}: JSON parse failed`);
  }
};

/* -------------------------------
   SPLIT OCR INTO PAGES
-------------------------------- */
const splitIntoPages = (text) => {
  return text
    .split(/Result for Image\/Page\s+\d+/i)
    .map((p) => p.trim())
    .filter(Boolean);
};

/* -------------------------------
   API ENDPOINT
-------------------------------- */
app.post("/parse-bank-statement", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    /* ---- OCR ---- */
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const ocrResponse = await axios.post(
      "http://localhost:3000/server/ocr/",
      form,
      { headers: form.getHeaders() }
    );

    const ocrText = ocrResponse?.data?.data?.text;
    if (!ocrText) throw new Error("Empty OCR result");

    /* ---- LLM PASS 1: METADATA ---- */
    const metaLLM = await axios.post("http://localhost:11434/api/generate", {
      model: "llama3",
      prompt: buildAccountMetaPrompt(ocrText),
      stream: false,
    });

    const accountMeta = sanitizeAndParseJSON(metaLLM.data.response, "Metadata");

    /* ---- LLM PASS 2: TRANSACTIONS (PAGE-WISE) ---- */
    const pages = splitIntoPages(ocrText);
    let allTransactions = [];

    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i];

      const txnLLM = await axios.post("http://localhost:11434/api/generate", {
        model: "llama3",
        prompt: buildTransactionPrompt(pageText),
        stream: false,
      });

      const pageTxnData = sanitizeAndParseJSON(
        txnLLM.data.response,
        `Transactions page ${i + 1}`
      );

      allTransactions.push(...(pageTxnData.transactions || []));
    }

    /* ---- FINAL RESPONSE ---- */
    const result = {
      fileName: req.file.originalname,
      accounts: [
        {
          ...accountMeta,
          openingBalance: "",
          closingBalance: "",
          transactions: allTransactions,
        },
      ],
    };

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
