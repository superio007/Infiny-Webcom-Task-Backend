const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");

async function test() {
  const form = new FormData();
  form.append("file", fs.readFileSync("statement.pdf"), {
    filename: "statement.pdf",
    contentType: "application/pdf",
  });

  try {
    const res = await axios.post(
      "http://localhost:4000/parse-bank-statement",
      form,
      {
        headers: form.getHeaders(),
        timeout: 300000,
      }
    );

    console.log("Accounts found:", res.data.accounts.length);
    res.data.accounts.forEach((acc, i) => {
      console.log(`\nAccount ${i + 1}: ${acc.accountNumber}`);
      console.log("  Bank:", acc.bankName);
      console.log("  Holder:", acc.accountHolderName);
      console.log("  Transactions:", acc.transactions.length);
    });
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}

test();
