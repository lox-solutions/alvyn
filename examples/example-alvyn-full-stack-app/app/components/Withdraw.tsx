import { useState } from "react";
import { useMutation } from "@apollo/client/react/index.js";
import { WITHDRAW } from "../graphql/mutations";
import {
  sectionStyle,
  inputRowStyle,
  inputStyle,
  buttonStyle,
  resultStyle,
} from "../styles/shared";

export function Withdraw() {
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [withdraw, { loading, data, error }] = useMutation(WITHDRAW);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !amount) return;
    await withdraw({ variables: { accountId, amount: parseFloat(amount) } });
  };

  return (
    <section style={sectionStyle}>
      <h2>Send Money</h2>
      <form onSubmit={handleSubmit}>
        <div style={inputRowStyle}>
          <input
            type="text"
            placeholder="Account ID"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={loading} style={buttonStyle}>
            Send
          </button>
        </div>
      </form>
      <pre style={resultStyle}>
        {error
          ? `Error: ${error.message}`
          : data
            ? JSON.stringify(data, null, 2)
            : ""}
      </pre>
    </section>
  );
}