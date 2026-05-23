'use client';

import { useState } from 'react';
import { Terminal, Copy, Check, FileCode, Server, Play, ShieldAlert } from 'lucide-react';

const TABS = [
  {
    id: 'events',
    title: '1. Define Events',
    icon: FileCode,
    language: 'typescript',
    code: `// Define type-safe event payload contracts
export type CartEvents = {
  CartCreated: { cartId: string; userId: string };
  ItemAdded: { sku: string; price: number; name: string };
  CouponApplied: { code: string; discount: number };
  CheckoutCompleted: { paymentId: string; totalPaid: number };
};`,
    explanation: 'Define event payloads explicitly using standard TypeScript types. Your codebase represents business reality without translation-loss.'
  },
  {
    id: 'postgres',
    title: '2. Native PG Connection',
    icon: Server,
    language: 'typescript',
    code: `import { EventStore } from 'alvyn';
import { Pool } from 'pg';

// Initialize on top of the PostgreSQL pool you already trust
const eventStore = new EventStore({
  pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  schema: 'public', // No special infra or cluster needed
});

// Run idempotent schema migrations on startup
await eventStore.setup();`,
    explanation: 'Zero deployment overhead. Runs directly on PostgreSQL. The .setup() method creates all required tables and indexes natively and safely.'
  },
  {
    id: 'evolve',
    title: '3. Define Aggregate',
    icon: Play,
    language: 'typescript',
    code: `import { defineAggregate } from 'alvyn';

interface CartState {
  items: Array<{ sku: string; price: number }>;
  discount: number;
  isCompleted: boolean;
}

// Group related events into a highly cohesive Domain Aggregate
export const Cart = defineAggregate<CartEvents>()({
  streamPrefix: 'Cart',
  initialState: () => ({ items: [], discount: 0, isCompleted: false }),
  evolve: {
    CartCreated: (state) => state,
    ItemAdded: (state, event) => ({ ...state, items: [...state.items, event.data] }),
    CouponApplied: (state, event) => ({ ...state, discount: event.data.discount }),
    CheckoutCompleted: (state) => ({ ...state, isCompleted: true }),
  },
});`,
    explanation: 'State evolution is purely mathematical and deterministic. Zero side effects, easy to test, and perfectly typed.'
  },
  {
    id: 'append',
    title: '4. Append & Replay',
    icon: ShieldAlert,
    language: 'typescript',
    code: `const entityId = '8f2a'; // resolves to stream_id: 'Cart-8f2a'

// 1. Append type-safe event facts with optimistic concurrency
await Cart.append(eventStore, entityId, {
  expectedVersion: 0, // Ensure concurrency guarantees
  events: [
    {
      type: 'ItemAdded',
      data: { sku: 'INFRA-DATA-BUNDLE', price: 240.0, name: 'Data Platform Bundle' }
    }
  ]
});

// 2. Load aggregate state with automatic snapshotting
const { state, version } = await Cart.load(eventStore, entityId);`,
    explanation: 'Appended facts are saved to Postgres. State queries replay history at ultra-high speed, utilizing automatic snapshotting and crypto-shredding hooks under the hood.'
  }
];

export function CodeShowcase() {
  const [activeTab, setActiveTab] = useState('events');
  const [copied, setCopied] = useState(false);

  const activeData = TABS.find((t) => t.id === activeTab) || TABS[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(activeData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-5xl bg-zinc-950 border border-zinc-900 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-auto md:h-[500px]">
      {/* Sidebar Navigation */}
      <div className="w-full md:w-1/3 bg-[#09090b] border-b md:border-b-0 md:border-r border-zinc-900 p-6 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-mono font-medium text-zinc-500 uppercase tracking-widest mb-6">
            <Terminal size={14} />
            Declarative Engine
          </div>
          <div className="space-y-1.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-semibold transition-all text-left border cursor-pointer ${
                    isSelected
                      ? 'bg-zinc-900 text-white border-zinc-800 shadow-md'
                      : 'bg-transparent text-zinc-400 border-transparent hover:bg-zinc-900/40 hover:text-zinc-200'
                  }`}
                >
                  <Icon size={14} className={isSelected ? 'text-zinc-100' : 'text-zinc-500'} />
                  {tab.title}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8 md:mt-0 p-4 rounded-2xl bg-zinc-900/30 border border-zinc-900">
          <p className="text-[10px] font-mono font-semibold text-zinc-500 uppercase tracking-wider mb-1">
            Engineers as domain experts
          </p>
          <p className="text-xs text-zinc-400 leading-relaxed font-light">
            {activeData.explanation}
          </p>
        </div>
      </div>

      {/* Code Editor View */}
      <div className="flex-1 bg-[#040406] flex flex-col relative h-[320px] md:h-full">
        {/* Editor Tab Bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-900/60 bg-black/40">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
            </div>
            <span className="text-[10px] font-mono text-zinc-500 ml-3 bg-zinc-900/40 px-2.5 py-1 rounded-full border border-zinc-850">
              {activeData.id}.ts
            </span>
          </div>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md hover:bg-zinc-900 text-zinc-500 hover:text-zinc-200 transition-all cursor-pointer"
            title="Copy Code"
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
        </div>

        {/* Code Content */}
        <div className="flex-1 p-6 overflow-auto font-mono text-xs text-left leading-relaxed text-zinc-300">
          <pre className="whitespace-pre">
            <code>
              {activeData.code.split('\n').map((line, idx) => (
                <div key={idx} className="table-row">
                  <span className="table-cell text-right pr-4 text-zinc-700 select-none w-8 text-[10px]">
                    {idx + 1}
                  </span>
                  <span className="table-cell">
                    {/* Basic visual coloring of strings and comments for premium presentation */}
                    {line.trim().startsWith('//') ? (
                      <span className="text-zinc-500/80 italic">{line}</span>
                    ) : (line.includes('type ') || line.includes('interface ') || line.includes('import ') || line.includes('const ') || line.includes('await ') || line.includes('export ')) ? (
                      <span>
                        {line.split(' ').map((word, i) => {
                          const cleanWord = word.replace(/[;,:{()}]/g, '');
                          const isKeyword = ['type', 'interface', 'import', 'from', 'export', 'const', 'await', 'return', 'switch', 'case', 'default'].includes(cleanWord);
                          return (
                            <span key={i}>
                              {isKeyword ? (
                                <span className="text-purple-400 font-semibold">{word}</span>
                              ) : (
                                word
                              )}
                              {i < line.split(' ').length - 1 ? ' ' : ''}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      line
                    )}
                  </span>
                </div>
              ))}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
