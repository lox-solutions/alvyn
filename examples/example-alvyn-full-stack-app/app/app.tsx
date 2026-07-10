import { useState } from "react";
import {
  CreateAccount,
  GetAccount,
  CheckBalance,
  Deposit,
  Withdraw,
  GetTransactions,
  LiveTransactions,
  LiveBalance,
} from "./components";
import { containerStyle } from "./styles/shared";
import React from "react";

export default function App() {
  const [accountId, setAccountId] = useState("");

  return (
    <div style={containerStyle}>
      <h1>Bank Account Demo</h1>
      <div style={{ display: "flex", gap: "24px" }}>
        <div style={{ flex: 1 }}>
          <CreateAccount />
          <GetAccount />
          <CheckBalance />
          <Deposit />
          <Withdraw />
          <GetTransactions />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: "16px" }}>
            <label>
              Account ID for Live View:{" "}
              <input
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="Enter account ID"
              />
            </label>
          </div>
          <LiveBalance accountId={accountId} />
          <LiveTransactions accountId={accountId} />
        </div>
      </div>
    </div>
  );
}
