import { useState, useEffect, useRef } from "react";
import { useSubscription } from "@apollo/client/react";
import { TRANSACTION_ADDED } from "../graphql/subscriptions";
import { sectionStyle, resultStyle } from "../styles/shared";

interface Transaction {
  type: string;
  bankAccountId: string;
  amount: number | null;
}

interface Props {
  accountId: string;
}

interface TransactionAddedData {
  transactionAdded: Transaction | null;
}

interface TransactionAddedVariables {
  accountId: string;
}

export function LiveTransactions({ accountId }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useSubscription<TransactionAddedData, TransactionAddedVariables>(TRANSACTION_ADDED, {
    variables: { accountId },
    onData: ({ data }) => {
      const tx = data.data?.transactionAdded;
      if (tx) {
        setTransactions((prev) => [...prev, tx]);
      }
    },
    skip: !accountId,
  });

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [transactions]);

  if (!accountId) {
    return null;
  }

  return (
    <section style={sectionStyle}>
      <h2>Live Transactions</h2>
      <div
        ref={containerRef}
        style={{
          maxHeight: "calc(100vh - 200px)",
          overflowY: "auto",
          background: "#f5f5f5",
          padding: "8px",
        }}
      >
        {transactions.length === 0 ? (
          <p>Waiting for transactions...</p>
        ) : (
          transactions.map((tx, i) => (
            <div key={i} style={resultStyle}>
              {tx.type}: ${tx.amount}
            </div>
          ))
        )}
      </div>
    </section>
  );
}