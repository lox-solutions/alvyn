'use client';

import { useState } from 'react';
import { Database, Brain, Sparkles, RefreshCw, BookOpen, Calendar, ArrowLeftRight, CheckCircle2, AlertTriangle } from 'lucide-react';

type Step = 0 | 1 | 2 | 3 | 4;

export function JourneySimulator() {
  const [step, setStep] = useState<Step>(0);

  const reset = () => setStep(0);

  const getCrudData = () => {
    switch (step) {
      case 0:
        return null;
      case 1:
        return {
          table: "book_loans",
          row: {
            id: "loan_7b29",
            member_id: "usr_9921",
            book_title: "Intro to Prompt Engineering",
            due_date: "15:24:02",
            status: "borrowed",
            fine_assessed: 0.00,
            updated_at: "15:24:02"
          }
        };
      case 2:
        return {
          table: "book_loans",
          row: {
            id: "loan_7b29",
            member_id: "usr_9921",
            book_title: "Intro to Prompt Engineering",
            due_date: "15:24:18",
            status: "borrowed",
            fine_assessed: 0.00,
            updated_at: "15:24:18"
          }
        };
      case 3:
        return {
          table: "book_loans",
          row: {
            id: "loan_7b29",
            member_id: "usr_9921",
            book_title: "Designing Data-Intensive Applications",
            due_date: "15:24:35",
            status: "borrowed",
            fine_assessed: 15.00,
            updated_at: "15:24:35"
          }
        };
      case 4:
        return {
          table: "book_loans",
          row: {
            id: "loan_7b29",
            member_id: "usr_9921",
            book_title: "Designing Data-Intensive Applications",
            due_date: "15:24:35",
            status: "returned",
            fine_assessed: 15.00,
            updated_at: "15:24:50"
          }
        };
    }
  };

  const getEvents = () => {
    const list = [];
    if (step >= 1) {
      list.push({
        id: "evt_01",
        time: "15:24:02",
        type: "BookBorrowed",
        data: { bookId: "book_prompt", memberId: "usr_9921", title: "Intro to Prompt Engineering" },
        desc: "New loan session initialized by active library member."
      });
    }
    if (step >= 2) {
      list.push({
        id: "evt_02",
        time: "15:24:18",
        type: "LoanExtended",
        data: { daysAdded: 14, extensionReason: "Need more time to read" },
        desc: "Member requested loan extension to complete reading."
      });
    }
    if (step >= 3) {
      list.push({
        id: "evt_03",
        time: "15:24:30",
        type: "BookReportedLost",
        data: { bookId: "book_prompt", fineAmount: 15.00 },
        desc: "Member reported book as misplaced; replacement fine registered."
      });
      list.push({
        id: "evt_04",
        time: "15:24:32",
        type: "BookReturned",
        data: { bookId: "book_prompt", returnedCondition: "excellent" },
        desc: "Misplaced book found in backpack and returned; fine waived/refunded."
      });
      list.push({
        id: "evt_05",
        time: "15:24:35",
        type: "BookBorrowed",
        data: { bookId: "book_data", memberId: "usr_9921", title: "Designing Data-Intensive Applications" },
        desc: "Member realized commodity prompts are trivial; upgraded to high-value data system guides."
      });
    }
    if (step >= 4) {
      list.push({
        id: "evt_06",
        time: "15:24:50",
        type: "BookReturned",
        data: { bookId: "book_data", returnedCondition: "excellent" },
        desc: "Loan closed. All physical assets successfully accounted for."
      });
    }
    return list;
  };

  const getAiInsight = () => {
    switch (step) {
      case 0:
        return {
          title: "Waiting for intent signals...",
          text: "Click an action above to begin simulating real member library activity.",
          crudNote: "CRUD system will perform overwrite (UPDATE) queries in-place.",
          eventNote: "Alvyn will stream immutable state facts directly into PostgreSQL."
        };
      case 1:
        return {
          title: "Initial Intent Decoded",
          text: "The library member is researching AI and prompt engineering. They are exploring commodity-level AI software builders.",
          crudNote: "CRUD stores one static snapshot. Represents current status 'borrowed'.",
          eventNote: "Alvyn captures the atomic sequence: BookBorrowed event with metadata."
        };
      case 2:
        return {
          title: "Reading Habits Analyzed",
          text: "Member extended the loan. This signals higher engagement or more thorough analysis than a casual reader.",
          crudNote: "CRUD overwrites fields: due_date is now extended. Previous due date is gone.",
          eventNote: "Alvyn appends LoanExtended. The timeline preserves original checkout constraints for analytics."
        };
      case 3:
        return {
          title: "CRITICAL PIVOT: The AI Realization",
          text: "The member misplaced the basic prompt book, resolved the fine, and immediately upgraded to 'Designing Data-Intensive Applications'. They realized that coding simple prompts is a commodity and building a robust data platform/moat is where the value lies.",
          crudNote: "CRUD overwrites entire row. No record remains that they ever borrowed the prompt engineering book or reported it lost.",
          eventNote: "Alvyn records BookReportedLost, BookReturned, and BookBorrowed. This is a massive business signal of the member's shifting profile."
        };
      case 4:
        return {
          title: "Deep Member Persona Unlocked",
          text: "Borrowing cycle complete. We have built an invaluable, high-fidelity member intelligence record.",
          crudNote: "CRUD insight: 'Returned book' (Generic member, send standard library announcements).",
          eventNote: "Alvyn insight: 'High-value developer who abandoned commodity prompt guides to study core database & data platform architectures. Trigger targeted invite to the upcoming Alvyn PostgreSQL-native streams workshop.' This is your data moat in action."
        };
    }
  };

  const crud = getCrudData();
  const events = getEvents();
  const ai = getAiInsight();

  return (
    <div className="w-full max-w-5xl bg-fd-background border border-fd-border rounded-2xl overflow-hidden shadow-2xl relative">
      {/* Simulation Controller */}
      <div className="p-6 border-b border-fd-border bg-fd-accent/20 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-left">
          <h3 className="text-sm font-bold uppercase tracking-wider text-fd-primary flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fd-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-fd-primary"></span>
            </span>
            Live Domain Simulator
          </h3>
          <p className="text-xs text-fd-muted-foreground mt-1">
            Simulate a member book-borrowing journey. Compare Traditional CRUD against Alvyn Event Sourcing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setStep(1)}
            disabled={step >= 1}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              step >= 1
                ? 'bg-fd-muted/30 text-fd-muted-foreground cursor-not-allowed'
                : 'bg-fd-accent hover:bg-fd-accent/80 text-fd-foreground border border-fd-border cursor-pointer'
            }`}
          >
            <BookOpen size={13} />
            1. Borrow Book
          </button>
          <button
            onClick={() => setStep(2)}
            disabled={step !== 1}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              step !== 1
                ? 'bg-fd-muted/30 text-fd-muted-foreground cursor-not-allowed'
                : 'bg-fd-accent hover:bg-fd-accent/80 text-fd-foreground border border-fd-border cursor-pointer'
            }`}
          >
            <Calendar size={13} />
            2. Extend Loan
          </button>
          <button
            onClick={() => setStep(3)}
            disabled={step !== 2}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              step !== 2
                ? 'bg-fd-muted/30 text-fd-muted-foreground cursor-not-allowed'
                : 'bg-fd-accent hover:bg-fd-accent/80 text-fd-foreground border border-fd-border cursor-pointer'
            }`}
          >
            <ArrowLeftRight size={13} />
            3. Report Lost & Swap
          </button>
          <button
            onClick={() => setStep(4)}
            disabled={step !== 3}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              step !== 3
                ? 'bg-fd-muted/30 text-fd-muted-foreground cursor-not-allowed'
                : 'bg-fd-primary text-fd-primary-foreground hover:opacity-90 shadow-md cursor-pointer'
            }`}
          >
            <CheckCircle2 size={13} />
            4. Return & Close
          </button>
          {step > 0 && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 cursor-pointer"
            >
              <RefreshCw size={13} />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Panel grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-fd-border h-[460px] overflow-hidden">
        {/* CRUD Database */}
        <div className="flex flex-col h-full bg-fd-background text-left">
          <div className="px-5 py-3 border-b border-fd-border bg-fd-accent/10 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-fd-muted-foreground flex items-center gap-2">
              <Database size={14} className="text-red-400" />
              Traditional CRUD PostgreSQL
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
              State-Destructive
            </span>
          </div>

          <div className="flex-1 p-5 overflow-auto font-mono text-xs select-none">
            {crud ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-[11px] text-fd-muted-foreground pb-2 border-b border-fd-border/50">
                  <span>Table: {crud.table}</span>
                  <span className="text-red-400 animate-pulse flex items-center gap-1">
                    <AlertTriangle size={10} /> Row Updated (Overwrite)
                  </span>
                </div>
                <div className="bg-fd-accent/25 border border-fd-border/50 rounded-lg p-4 space-y-2 relative overflow-hidden">
                  <div className="absolute top-2 right-2 bg-fd-border px-1.5 py-0.5 rounded text-[9px] text-fd-muted-foreground font-semibold">
                    1 row in table
                  </div>
                  <div>
                    <span className="text-purple-400">SELECT</span> * <span className="text-purple-400">FROM</span> {crud.table} <span className="text-purple-400">WHERE</span> id = <span className="text-amber-300">&apos;{crud.row.id}&apos;</span>;
                  </div>
                  <div className="text-fd-muted-foreground pt-3 space-y-1">
                    <div>{`{`}</div>
                    <div className="pl-4">id: <span className="text-amber-300">&apos;{crud.row.id}&apos;</span>,</div>
                    <div className="pl-4">member_id: <span className="text-amber-300">&apos;{crud.row.member_id}&apos;</span>,</div>
                    <div className="pl-4">
                      book_title: <span className="text-emerald-400 font-bold">&apos;{crud.row.book_title}&apos;</span>,{" "}
                      {step >= 3 && <span className="text-red-400 text-[10px] font-semibold">(overwrote prompt book)</span>}
                    </div>
                    <div className="pl-4">
                      due_date: <span className="text-amber-300">&apos;{crud.row.due_date}&apos;</span>,{" "}
                      {step >= 2 && <span className="text-red-400 text-[10px] font-semibold">(overwrote original date)</span>}
                    </div>
                    <div className="pl-4">
                      status: <span className="text-emerald-400 font-bold">&apos;{crud.row.status}&apos;</span>,{" "}
                      {step === 4 && <span className="text-red-400 text-[10px] font-semibold">(overwrote active/borrowed)</span>}
                    </div>
                    <div className="pl-4">
                      fine_assessed: <span className="text-amber-300">{crud.row.fine_assessed}.00</span>,{" "}
                      {step >= 3 && <span className="text-red-400 text-[10px] font-semibold">(overwrote 0.00)</span>}
                    </div>
                    <div className="pl-4">updated_at: <span className="text-amber-300">&apos;{crud.row.updated_at}&apos;</span></div>
                    <div>{`}`}</div>
                  </div>
                </div>
                <div className="text-[11px] text-red-400/80 bg-red-500/5 rounded p-3 border border-red-500/10 flex gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    No historical trajectory remains in the database. The system completely forgets the prompt engineering book, the extension, and the lost-then-returned saga.
                  </span>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-fd-muted-foreground p-6">
                <Database size={24} className="mb-3 text-fd-muted-foreground/50" />
                <p>Database is empty.</p>
                <p className="text-[11px] mt-1">Start the simulation by clicking "Borrow Book".</p>
              </div>
            )}
          </div>
        </div>

        {/* Alvyn Event Sourcing */}
        <div className="flex flex-col h-full bg-fd-accent/5 text-left">
          <div className="px-5 py-3 border-b border-fd-border bg-fd-accent/10 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-fd-primary flex items-center gap-2">
              <Sparkles size={14} />
              Alvyn Immutable Event Log
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Append-Only (No Overwrites)
            </span>
          </div>

          <div className="flex-1 p-5 overflow-auto font-mono text-xs space-y-3">
            {events.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[11px] text-fd-muted-foreground pb-2 border-b border-fd-border/50">
                  <span>Stream: loan-7b29</span>
                  <span className="text-emerald-400 font-semibold">{events.length} events recorded</span>
                </div>
                <div className="space-y-2 max-h-[340px] overflow-auto pr-1">
                  {events.map((evt, i) => (
                    <div
                      key={evt.id}
                      className="border border-emerald-500/10 bg-emerald-500/5 rounded-lg p-3 space-y-1 relative animate-in fade-in slide-in-from-bottom-2 duration-300"
                    >
                      <div className="flex items-center justify-between text-[10px] text-fd-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-400 font-bold">{evt.type}</span>
                          <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 rounded-sm">
                            Event #{i+1}
                          </span>
                        </div>
                        <span>{evt.time}</span>
                      </div>
                      <div className="text-fd-foreground font-semibold text-[11px]">{evt.desc}</div>
                      <pre className="text-[10px] text-fd-muted-foreground bg-black/30 p-1.5 rounded mt-1.5 overflow-x-auto">
                        {JSON.stringify(evt.data, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-fd-muted-foreground p-6">
                <Sparkles size={24} className="mb-3 text-fd-muted-foreground/30 animate-pulse" />
                <p>No events emitted yet.</p>
                <p className="text-[11px] mt-1">Alvyn is ready to stream immutable timeline facts.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Memory Agent Insights */}
      <div className="p-6 border-t border-fd-border bg-fd-accent/10 flex flex-col md:flex-row gap-6 items-start text-left">
        <div className="flex items-center gap-3 shrink-0">
          <div className="p-2.5 rounded-xl bg-fd-primary/10 border border-fd-primary/20 text-fd-primary">
            <Brain size={20} className="animate-pulse" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-fd-foreground">
              AI System Intelligence
            </h4>
            <span className="text-[10px] text-fd-muted-foreground block font-mono">
              Model Capacity Multiplier
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          <div className="text-sm font-bold text-fd-foreground flex items-center gap-1.5">
            {step > 0 && <span className="inline-block w-2 h-2 rounded-full bg-fd-primary animate-ping" />}
            {ai.title}
          </div>
          <p className="text-xs text-fd-muted-foreground leading-relaxed">
            {ai.text}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-fd-border/30">
            <div>
              <span className="text-[10px] font-bold text-red-400 block mb-1">AI fed with CRUD snapshot:</span>
              <span className="text-xs text-fd-muted-foreground block leading-relaxed">{ai.crudNote}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-emerald-400 block mb-1">AI fed with Alvyn Event Log:</span>
              <span className="text-xs text-fd-muted-foreground block leading-relaxed font-semibold text-fd-foreground">{ai.eventNote}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
