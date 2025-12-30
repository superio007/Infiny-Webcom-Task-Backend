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

const buildPrompt = (ocrText) => {
  return `
You are a strict JSON generator.

RULES (MANDATORY):
- Output ONLY valid JSON
- Do NOT include explanations
- Do NOT include markdown
- Do NOT include backticks
- Do NOT include any text before or after JSON
- The first character must be {
- The last character must be }
- If a value is missing, use an empty string or empty array
- Do NOT guess or infer missing information

TASK:
Extract structured resume data from the text below.

OUTPUT SCHEMA (MUST MATCH EXACTLY):
{
  "fullName": "",
  "email": "",
  "phone": "",
  "skills": [],
  "workExperience": [
    {
      "company": "",
      "role": "",
      "duration": ""
    }
  ],
  "education": [
    {
      "institution": "",
      "degree": "",
      "year": ""
    }
  ]
}

RESUME TEXT:
"""
${ocrText}
"""
`;
};

app.post("/parse-resume", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Build multipart request for Catalyst
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    // Call Catalyst OCR
    const ocrResponse = await axios.post(
      "http://localhost:3000/server/ocr/",
      form,
      { headers: form.getHeaders() }
    );

    const ocrText = ocrResponse.data.data.text;

    // Send OCR text to Ollama
    const llmResponse = await axios.post(
      "http://localhost:11434/api/generate",
      {
        model: "llama3",
        prompt: buildPrompt(ocrText),
        stream: false,
      }
    );
    console.log("LLM Response:", llmResponse.data.response);
    const structured = JSON.parse(llmResponse.data.response);

    res.json({ success: true, data: structured });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
