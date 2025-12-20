# Bank Statement API Backend

Production-grade API backend for processing bank statement PDFs using AWS Textract and Google Gemini AI.

## Features

- PDF upload and validation
- AWS S3 storage integration
- AWS Textract document analysis
- Google Gemini AI data normalization
- Comprehensive error handling
- Property-based testing with fast-check

## Prerequisites

- Node.js 18+ LTS
- AWS Account with S3 and Textract access
- Google Cloud Account with Gemini API access

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file in the root directory:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET_NAME=your-bucket-name

# Google Gemini Configuration
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-1.5-pro

# Application Configuration
PORT=3000
NODE_ENV=development
MAX_FILE_SIZE_MB=10
REQUEST_TIMEOUT_MS=30000
```

## Scripts

- `npm start` - Start the production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

## API Endpoints

### Upload PDF

```
POST /api/statements/upload
```

### Process PDF

```
POST /api/statements/process/:jobId
```

### Get Results

```
GET /api/statements/result/:jobId
```

### Health Check

```
GET /health
```

## Project Structure

```
src/
├── controllers/    # HTTP request handlers
├── services/       # Business logic and external integrations
├── validators/     # Joi validation schemas
├── utils/          # Utility functions and helpers
├── types/          # Type definitions and constants
├── app.js          # Express application setup
└── test-setup.js   # Jest test configuration
```

## Testing

The project uses Jest for unit testing and fast-check for property-based testing.

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Development

1. Install dependencies: `npm install`
2. Set up environment variables in `.env`
3. Start development server: `npm run dev`
4. Run tests: `npm test`

## License

ISC
