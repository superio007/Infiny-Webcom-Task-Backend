# Bank Statement Parser API

A Node.js backend service that extracts structured data from PDF bank statements using OCR and AI-powered text analysis.

**Live Demo:** https://infiny-webcom-task-backend.onrender.com

## Overview

This API accepts PDF bank statements, processes them page-by-page using OCR technology, and leverages Google's Gemini AI to extract and normalize:

- Account metadata (bank name, account holder, account number, etc.)
- Transaction details (date, description, debit/credit amounts, running balance)

## Architecture & Workflow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PDF Upload    │────▶│   PDF Splitter  │────▶│   OCR Engine    │
│   (Multer)      │     │   (pdf-lib)     │     │  (OCR.space)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  JSON Response  │◀────│  Data Merger    │◀────│   Gemini AI     │
│   (accounts)    │     │  (per account)  │     │  (extraction)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Processing Flow

### 1. PDF Upload & Validation

- Accepts multipart form data with a PDF file
- Uses Multer with memory storage for efficient handling
- Validates file presence before processing

### 2. PDF Page Splitting

- Uses `pdf-lib` to split multi-page PDFs into individual pages
- Each page is processed independently for better accuracy
- Handles statements with multiple accounts across pages

### 3. OCR Processing (per page)

- Sends each page to OCR.space API (Engine 2)
- Extracts raw text from scanned/image-based PDFs
- Handles OCR failures gracefully, continuing to next page

### 4. AI-Powered Extraction (per page)

**Metadata Extraction:**

- Prompts Gemini AI to extract account details
- Identifies bank name, account holder, account number, currency
- Detects statement date range
- Handles multiple account numbers on same page

**Transaction Extraction:**

- Locates transaction blocks using pattern matching
- Prompts Gemini to normalize misaligned OCR text
- Preserves transaction order without inventing data

### 5. Account Aggregation

- Groups transactions by account number
- Uses regex patterns for reliable account number detection
- Falls back to LLM extraction when regex fails
- Merges metadata across pages for same account

## API Endpoint

### POST `/parse-bank-statement`

**Request:**

- Content-Type: `multipart/form-data`
- Body: `file` - PDF bank statement

**Response:**

```json
{
  "success": true,
  "fileName": "statement.pdf",
  "accounts": [
    {
      "accountNumber": "803-01867-3",
      "bankName": "Example Bank",
      "accountHolderName": "John Doe",
      "accountType": "Savings",
      "currency": "USD",
      "statementStartDate": "2024-01-01",
      "statementEndDate": "2024-01-31",
      "transactions": [
        {
          "date": "2024-01-05",
          "description": "ATM Withdrawal",
          "debitAmount": "500.00",
          "creditAmount": "",
          "runningBalance": "4500.00"
        }
      ]
    }
  ]
}
```

## Key Features

- **Multi-Account Support:** Handles statements with multiple accounts
- **Robust Parsing:** Regex + AI hybrid approach for account number detection
- **Error Resilience:** Continues processing even if individual pages fail
- **JSON Cleanup:** Fixes common LLM JSON output issues (trailing commas, etc.)
- **Pattern Detection:** Multiple transaction header patterns supported

## Tech Stack

| Component      | Technology        |
| -------------- | ----------------- |
| Runtime        | Node.js           |
| Framework      | Express.js 5.x    |
| PDF Processing | pdf-lib           |
| File Upload    | Multer            |
| OCR            | OCR.space API     |
| AI/LLM         | Google Gemini API |
| HTTP Client    | Axios             |

## Environment Variables

```env
OCR_API_KEY=your_ocr_space_api_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash  # optional, defaults to gemini-2.0-flash
PORT=4000  # optional, defaults to 4000
```

## Installation & Setup

```bash
# Clone the repository
git clone <repository-url>
cd zohoexpress

# Install dependencies
npm install

# Create .env file with required API keys
cp .env.example .env

# Start development server
npm run dev

# Start production server
npm start
```

## Usage Example

```bash
curl -X POST https://infiny-webcom-task-backend.onrender.com/parse-bank-statement \
  -F "file=@statement.pdf"
```

## Account Number Detection

The system uses a hybrid approach:

1. **Regex Patterns** (Primary - more reliable):

   - `XXX-XXXXX-X` format (e.g., 803-01867-3)
   - Alphanumeric variants

2. **LLM Extraction** (Fallback):
   - Gemini AI extracts from context
   - Handles non-standard formats

## Error Handling

- OCR failures: Logs warning, continues to next page
- Metadata extraction failures: Uses defaults, continues
- Transaction extraction failures: Skips page transactions
- Invalid JSON from LLM: Attempts auto-repair, then fails gracefully

## Limitations

- Requires clear, readable PDF scans
- OCR accuracy depends on document quality
- Rate limited by external API quotas (OCR.space, Gemini)
- Processing time scales with page count

## License

ISC
