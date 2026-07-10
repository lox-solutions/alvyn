import { useState } from "react";
import { useQuery } from "@apollo/client/react/index.js";
import { GET_BANK_ACCOUNT } from "../graphql/queries";
import {
  sectionStyle,
  inputRowStyle,
  inputStyle,
  buttonStyle,
  resultStyle,
} from "../styles/shared";

export function GetAccount() {
  const [id, setId] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const { data, loading, error } = useQuery(GET_BANK_ACCOUNT, {
    variables: { id: submittedId },
    skip: !submittedId,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSubmittedId(id);
  };

  return (
    <section style={sectionStyle}>
      <h2>Get Bank Account</h2>
      <form onSubmit={handleSubmit}>
        <div style={inputRowStyle}>
          <input
            type="text"
            placeholder="Account ID"
            value={id}
            onChange={(e) => setId(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={loading || !id} style={buttonStyle}>
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