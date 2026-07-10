import { useState } from "react";
import { useQuery } from "@apollo/client/react/index.js";
import { GET_TRANSACTIONS } from "../graphql/queries";
import {
  sectionStyle,
  inputRowStyle,
  inputStyle,
  buttonStyle,
  resultStyle,
} from "../styles/shared";

export function GetTransactions() {
  const [accountId, setAccountId] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const { data, loading, error } = useQuery(GET_TRANSACTIONS, {
    variables: { accountId: submittedId },
    skip: !submittedId,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;
    setSubmittedId(accountId);
  };

  return (
    <section style={sectionStyle}>
      <h2>Get Transactions</h2>
      <form onSubmit={handleSubmit}>
        <div style={inputRowStyle}>
          <input
            type="text"
            placeholder="Account ID"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={loading || !accountId} style={buttonStyle}>
            Get
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