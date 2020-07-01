if (!process.env.NETLIFY) {
  require("dotenv").config();
}
const { GoogleSpreadsheet } = require("google-spreadsheet");
const axios = require("axios");

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  GOOGLE_SPREADSHEET_ID_FROM_URL,
  PAYMONGO_EMAIL,
  PAYMONGO_PASS,
  PAYMONGO_LIVEMODE,
} = process.env;

if (!GOOGLE_SERVICE_ACCOUNT_EMAIL)
  throw new Error("No GOOGLE_SERVICE_ACCOUNT_EMAIL env var set");
if (!GOOGLE_PRIVATE_KEY) throw new Error("No GOOGLE_PRIVATE_KEY env var set");
if (!GOOGLE_SPREADSHEET_ID_FROM_URL)
  throw new Error("No GOOGLE_SPREADSHEET_ID_FROM_URL env var set");
if (!PAYMONGO_EMAIL) throw new Error("No PAYMONGO_EMAIL env var set");
if (!PAYMONGO_PASS) throw new Error("No PAYMONGO_PASS env var set");
if (!PAYMONGO_LIVEMODE) throw new Error("No PAYMONGO_LIVEMODE env var set");

const URL = "https://gateway.paymongo.com/transactions";
const AUTH_URI = "https://gateway.paymongo.com/auth";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed!" }),
      headers: { Allow: "POST" },
    };
  }

  const getApiToken = async () => {
    let credentials = {
      data: {
        attributes: {
          email: PAYMONGO_EMAIL,
          password: PAYMONGO_PASS,
        },
      },
    };
    try {
      const res = await axios({
        method: "post",
        url: AUTH_URI,
        data: credentials,
      });
      const token = await res.data.data.id;
      return token;
    } catch (error) {
      console.log(error);
      return error;
    }
  };

  const {
    reference_no = null,
    message = null,
    email = null,
    type = "cancellation",
    mop = null,
    mop_details = null,
  } = JSON.parse(event.body);

  let validationError = [];

  if (!reference_no) {
    let error = {
      field: "reference_no",
      message: "No Reference No Submitted",
    };
    validationError.push(error);
  }

  if (!message) {
    let error = {
      field: "message",
      message: "No Message Submitted",
    };
    validationError.push(error);
  }

  if (!email) {
    let error = {
      field: "email",
      message: "No Email Submitted",
    };
    validationError.push(error);
  }

  if (!mop) {
    let error = {
      field: "mop",
      message: "No Mode Of Payment Submitted",
    };
    validationError.push(error);
  }

  if (!mop_details) {
    let error = {
      field: "mop_details",
      message:
        "No Payout Details Submitted",
    };
    validationError.push(error);
  }

  const types = [
    "cancellation",
    "back_order",
    "defective",
    "deceptive",
    "counterfeit",
    "missing",
    "expired",
  ];

  if (!types.include(type)) {
    let error = {
      field: "type",
      message: "Refund Type Submitted is Invalid!",
    };
    validationError.push(error);
  }

  if (validationError.length > 0) {
    return {
      statusCode: 422,
      body: JSON.stringify({ errors: validationError }),
    };
  }

  const getAmount = async (reference_no) => {
    let endpoint = `${URL}/${reference_no}?livemode=${PAYMONGO_LIVEMODE}`;

    const token = await getApiToken();

    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;

    var payment;
    try {
      payment = await axios.get(endpoint);
    } catch (e) {
      return {
        statusCode: 404,
        body: JSON.stringify("Reference No. Not Found!"),
      };
    }

    let attributes = payment.data.data.attributes;

    let payments = attributes.payments;

    const paymentIndex = payments.findIndex((x) => x.status === "paid");

    if (paymentIndex == -1) {
      return {
        statusCode: 500,
        body: JSON.stringify("You Cannot Request Refund On UNPAID Order!"),
      };
    }

    let payment_details = attributes.payments[paymentIndex];

    const { currency, net_amount, paid_at, billing } = payment_details;

    const { name, email, phone } = billing;
    return {
      currency,
      amount: `${parseFloat(net_amount) / 100}`,
      date_paid: new Date(paid_at * 1000),
      name,
      email,
      phone,
    };
  };

  try {
    const doc = new GoogleSpreadsheet(GOOGLE_SPREADSHEET_ID_FROM_URL);

    await doc.useServiceAccountAuth({
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    });

    await doc.loadInfo();

    var refund_sheet = doc.sheetsById[3];

    if (!refund_sheet) {
      await doc.addSheet({
        headerValues: [
          "reference_no",
          "currency",
          "amount",
          "refundable_until",
          "message",
          "email",
          "phone",
          "type",
          "mop",
          "mop_details",
          "approved",
          "remarks",
        ],
        sheetId: 3,
      });

      refund_sheet = doc.sheetsById[3];
      await refund_sheet.updateProperties({ title: "Refunds" });
    }

    try {
      await refund_sheet.loadHeaderRow();
    } catch (e) {
      await refund_sheet.updateProperties({ title: "Refunds" });
      await refund_sheet.setHeaderRow([
        "reference_no",
        "currency",
        "amount",
        "refundable_until",
        "message",
        "email",
        "phone",
        "type",
        "mop",
        "mop_details",
        "approved",
        "remarks",
      ]);
    }

    const { currency, amount, date_paid, name, phone } = await getAmount(
      reference_no
    );

    let d = date_paid.getDate();
    let m = date_paid.getMonth();
    let y = date_paid.getFullYear();
    let refundable_until = `${y}-${m}-${d}`;

    let expiration_date = date_paid.setHours(date_paid.getHours() + 48);
    if (new Date() <= expiration_date) {
      console.log("create a mail function to send email to paymongo");
    }

    await refund_sheet.addRow({
      reference_no,
      refundable_until,
      name,
      phone,
      message,
      email,
      currency,
      amount,
      type,
      mop,
      mop_details,
    });

    return {
      statusCode: 200,
      body: JSON.stringify("Refund Request Successfully Submitted"),
    };
  } catch (e) {
    console.log(e.toString());
    return {
      statusCode: 500,
      body: e.toString(),
    };
  }
};
