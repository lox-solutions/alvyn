import { createRoot } from "react-dom/client";
import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink,
  Observable,
} from "@apollo/client/core";
import { getMainDefinition } from "@apollo/client/utilities";
import { print } from "graphql";
import { ApolloProvider } from "@apollo/client/react";
import { StrictMode } from "react";
import App from "./app";
import React from "react";
import { createClient } from "graphql-sse";

class SSELink extends ApolloLink {
  private client: ReturnType<typeof createClient>;

  constructor(options: { url: string }) {
    super();
    this.client = createClient(options);
  }

  public override request(
    operation: ApolloLink.Operation,
  ): Observable<ApolloLink.Result> {
    return new Observable<ApolloLink.Result>((sink) => {
      return this.client.subscribe(
        {
          query: print(operation.query),
          variables: operation.variables,
          operationName: operation.operationName,
          extensions: operation.extensions,
        },
        {
          next: sink.next.bind(sink),
          complete: sink.complete.bind(sink),
          error: sink.error.bind(sink),
        },
      );
    });
  }
}

const httpLink = new HttpLink({ uri: "/graphql" });
const sseLink = new SSELink({ url: "/graphql" });

const splitLink = ApolloLink.split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === "OperationDefinition" &&
      definition.operation === "subscription"
    );
  },
  sseLink,
  httpLink,
);

const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});

const rootElement = document.getElementById("app");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ApolloProvider client={client}>
        <App />
      </ApolloProvider>
    </StrictMode>,
  );
}
