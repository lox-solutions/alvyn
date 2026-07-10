import { useState } from "react";
import { useMutation } from "@apollo/client/react/index.js";
import { CREATE_ACCOUNT } from "../graphql/mutations";
import {
  sectionStyle,
  inputRowStyle,
  inputStyle,
  buttonStyle,
  resultStyle,
} from "../styles/shared";

export function CreateAccount() {
  const [accountId, setAccountId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [createAccount, { loading, data, error }] = useMutation(CREATE_ACCOUNT);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !ownerName) return;
    await createAccount({ variables: { accountId, ownerName } });
  };

  return (
    <section style={sectionStyle}>
      <h2>Create Bank Account</h2>
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
            type="text"
            placeholder="Owner Name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={loading} style={buttonStyle}>
            Create
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