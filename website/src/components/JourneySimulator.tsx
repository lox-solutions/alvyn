"use client";

import { useState } from "react";
import {
  Database,
  Brain,
  Sparkles,
  RefreshCw,
  BookOpen,
  Calendar,
  ArrowLeftRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

type Step = 0 | 1 | 2 | 3 | 4;

export function JourneySimulator() {
  const [step, setStep] = useState<Step>(0);

  const reset = () => setStep(0);

  // ── LIBRARY SCENARIO DATA ────────────────────────────────────────────
  const getLibraryCrudData = () => {
    switch (step) {
      case 0:
        return null;
      case 1:
        return {
          table: "member_current_loans",
          row: {
            id: "loan_usr_9921",
            member_id: "usr_9921",
            book_id: "book_prompt",
            book_title: "Intro to Prompt Engineering",
            due_date: "2026-09-07",
            status: "borrowed",
            fine_assessed: 0.0,
            updated_at: "15:24:02",
          },
        };
      case 2:
        return {
          table: "member_current_loans",
          row: {
            id: "loan_usr_9921",
            member_id: "usr_9921",
            book_id: "book_prompt",
            book_title: "Intro to Prompt Engineering",
            due_date: "2026-09-21",
            status: "borrowed",
            fine_assessed: 0.0,
            updated_at: "15:24:18",
          },
        };
      case 3:
        return {
          table: "member_current_loans",
          row: {
            id: "loan_usr_9921",
            member_id: "usr_9921",
            book_id: "book_data",
            book_title: "Designing Data-Intensive Applications",
            due_date: "2026-09-21",
            status: "borrowed",
            fine_assessed: 0.0,
            updated_at: "15:24:35",
          },
        };
      case 4:
        return {
          table: "member_current_loans",
          row: {
            id: "loan_usr_9921",
            member_id: "usr_9921",
            book_id: "book_data",
            book_title: "Designing Data-Intensive Applications",
            due_date: "2026-09-21",
            status: "returned",
            fine_assessed: 0.0,
            updated_at: "15:24:50",
          },
        };
    }
  };

  const getLibraryEvents = () => {
    const list = [];
    if (step >= 1) {
      list.push({
        id: "evt_01",
        time: "15:24:02",
        type: "BookBorrowed",
        data: {
          memberId: "usr_9921",
          bookId: "book_prompt",
          title: "Intro to Prompt Engineering",
          dueDate: "2026-09-07",
        },
        desc: "New checkout initiated for member usr_9921.",
      });
    }
    if (step >= 2) {
      list.push({
        id: "evt_02",
        time: "15:24:18",
        type: "LoanExtended",
        data: {
          memberId: "usr_9921",
          bookId: "book_prompt",
          title: "Intro to Prompt Engineering",
          daysAdded: 14,
          newDueDate: "2026-09-21",
          reason: "Need more time to complete reading",
        },
        desc: "Member requested 14-day loan extension for Prompt Engineering.",
      });
    }
    if (step >= 3) {
      list.push({
        id: "evt_03",
        time: "15:24:30",
        type: "BookReportedLost",
        data: {
          memberId: "usr_9921",
          bookId: "book_prompt",
          title: "Intro to Prompt Engineering",
          fineAssessed: 15.0,
        },
        desc: "Member reported Prompt Engineering book lost; replacement fee assessed.",
      });
      list.push({
        id: "evt_04",
        time: "15:24:32",
        type: "BookFoundAndReturned",
        data: {
          memberId: "usr_9921",
          bookId: "book_prompt",
          title: "Intro to Prompt Engineering",
        },
        desc: "Book found in library study carrel 2 minutes later.",
      });
      list.push({
        id: "evt_05",
        time: "15:24:33",
        type: "FineWaived",
        data: {
          memberId: "usr_9921",
          amount: 15.0,
          reason: "Returned immediately upon discovery",
        },
        desc: "Replacement fine automatically reversed.",
      });
      list.push({
        id: "evt_06",
        time: "15:24:35",
        type: "BookBorrowed",
        data: {
          memberId: "usr_9921",
          bookId: "book_data",
          title: "Designing Data-Intensive Applications",
          dueDate: "2026-09-21",
        },
        desc: "Member shifted focus to core data architectures; checked out DDIA.",
      });
    }
    if (step >= 4) {
      list.push({
        id: "evt_07",
        time: "15:24:50",
        type: "BookReturned",
        data: {
          memberId: "usr_9921",
          bookId: "book_data",
          title: "Designing Data-Intensive Applications",
          returnedCondition: "mint",
        },
        desc: "Loan closed. All physical library assets successfully accounted for.",
      });
    }
    return list;
  };

  const getLibraryAiInsight = () => {
    switch (step) {
      case 0:
        return {
          title: "Start with a book loan",
          text: "Click an action above to begin simulating real member library activity.",
          crudNote:
            "This current-state-only example updates one row in place, without an audit table.",
          eventNote:
            "The event-history example retains each recorded transition. This is a browser illustration, not a live database connection.",
        };
      case 1:
        return {
          title: "One recorded checkout",
          text: "We know which book was borrowed and when. That does not tell us the member's motivation.",
          crudNote:
            "CRUD stores one static row in member_current_loans with status 'borrowed'.",
          eventNote:
            "Alvyn captures the atomic sequence: BookBorrowed event with full book and member metadata.",
        };
      case 2:
        return {
          title: "The original due date still matters",
          text: "The member extended the loan. The event history preserves both the original and the new due date.",
          crudNote:
            "CRUD overwrites fields: due_date is now extended. Previous checkout due date is permanently lost.",
          eventNote:
            "Alvyn appends LoanExtended. The stream preserves original checkout constraints for analytics.",
        };
      case 3:
        return {
          title: "Explain the zero balance",
          text: "The member reported a lost book, returned it, had the fine waived, and borrowed another book. A zero balance alone cannot explain those steps.",
          crudNote:
            "CRUD overwrites the entire active loan row. No record remains that they ever borrowed the prompt engineering book, extended it, or reported it lost.",
          eventNote:
            "The recorded loss, return, waiver, and new checkout remain available for support and review.",
        };
      case 4:
        return {
          title: "Same final state. More context.",
          text: "The loan is closed in both views. Only the history view explains how it got there — just as recorded tool steps can explain an agent run.",
          crudNote:
            "This row shows the final return, not the earlier extension and waived fine.",
          eventNote:
            "The event stream preserves the recorded transitions. Interpretation, retention, and permissions remain application responsibilities.",
        };
    }
  };

  const crud = getLibraryCrudData();
  const events = getLibraryEvents();
  const ai = getLibraryAiInsight();

  return (
    <div className="w-full max-w-5xl bg-fd-secondary/30 border border-fd-border rounded-3xl overflow-hidden shadow-2xl relative">
      {/* Controller Header */}
      <div className="p-6 border-b border-fd-border bg-fd-secondary/30 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-left">
          <h3 className="text-sm font-semibold tracking-wide text-fd-foreground flex items-center gap-2 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
            </span>
            Live Domain &amp; State Simulator
          </h3>
          <p className="text-xs text-fd-muted-foreground">
            Compare a current-state-only table with recorded events.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setStep(1)}
            disabled={step >= 1}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all ${
              step >= 1
                ? "bg-fd-secondary text-fd-muted-foreground border border-fd-border/50 cursor-not-allowed opacity-40"
                : step === 0
                  ? "bg-fd-primary text-fd-primary-foreground font-semibold shadow-md cursor-pointer hover:opacity-90"
                  : "bg-fd-secondary border border-fd-border text-fd-secondary-foreground hover:bg-fd-accent cursor-pointer"
            }`}
          >
            <BookOpen size={13} />
            1. Borrow Book
          </button>
          <button
            onClick={() => setStep(2)}
            disabled={step !== 1}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all ${
              step !== 1
                ? "bg-fd-secondary text-fd-muted-foreground border border-fd-border/50 cursor-not-allowed opacity-40"
                : step === 1
                  ? "bg-fd-primary text-fd-primary-foreground font-semibold shadow-md cursor-pointer hover:opacity-90"
                  : "bg-fd-secondary border border-fd-border text-fd-secondary-foreground hover:bg-fd-accent cursor-pointer"
            }`}
          >
            <Calendar size={13} />
            2. Extend Loan
          </button>
          <button
            onClick={() => setStep(3)}
            disabled={step !== 2}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all ${
              step !== 2
                ? "bg-fd-secondary text-fd-muted-foreground border border-fd-border/50 cursor-not-allowed opacity-40"
                : step === 2
                  ? "bg-fd-primary text-fd-primary-foreground font-semibold shadow-md cursor-pointer hover:opacity-90"
                  : "bg-fd-secondary border border-fd-border text-fd-secondary-foreground hover:bg-fd-accent cursor-pointer"
            }`}
          >
            <ArrowLeftRight size={13} />
            3. Lost &amp; Swap
          </button>
          <button
            onClick={() => setStep(4)}
            disabled={step !== 3}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all ${
              step !== 3
                ? "bg-fd-secondary text-fd-muted-foreground border border-fd-border/50 cursor-not-allowed opacity-40"
                : "bg-fd-primary text-fd-primary-foreground font-semibold shadow-md cursor-pointer hover:opacity-90"
            }`}
          >
            <CheckCircle2 size={13} />
            4. Return &amp; Close
          </button>

          {step > 0 && (
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all bg-red-950/20 text-red-400 border border-red-900/30 hover:bg-red-900/20 cursor-pointer"
            >
              <RefreshCw size={13} />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Main Panel grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-fd-border overflow-hidden">
        {/* CRUD Database */}
        <div className="flex flex-col h-[380px] lg:h-[460px] min-w-0 bg-fd-background text-left">
          <div className="px-5 py-3 border-b border-fd-border bg-fd-secondary/10 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-fd-muted-foreground flex items-center gap-2">
              <Database size={14} className="text-red-500/80" />
              Current-state-only table
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/10">
              Latest values
            </span>
          </div>

          <div className="flex-1 p-5 overflow-auto font-mono text-xs select-none">
            {crud ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-[11px] text-fd-muted-foreground pb-2 border-b border-fd-border">
                  <span>Table: {crud.table}</span>
                  <span className="text-red-400 flex items-center gap-1">
                    <AlertTriangle size={10} /> Row Updated (Overwrite)
                  </span>
                </div>
                <div className="bg-fd-secondary/10 border border-fd-border rounded-2xl p-4 space-y-2 relative overflow-hidden">
                  <div className="absolute top-2 right-2 bg-fd-secondary px-2 py-0.5 rounded text-[9px] text-fd-muted-foreground font-medium border border-fd-border">
                    1 row in table
                  </div>
                  <div>
                    <span className="text-fd-muted-foreground">SELECT</span> *{" "}
                    <span className="text-fd-muted-foreground">FROM</span>{" "}
                    {crud.table}{" "}
                    <span className="text-fd-muted-foreground">WHERE</span> id ={" "}
                    <span className="text-fd-secondary-foreground">
                      &apos;{crud.row.id}&apos;
                    </span>
                    ;
                  </div>
                  <div className="text-fd-muted-foreground pt-3 space-y-1">
                    <div>{`{`}</div>
                    {Object.entries(crud.row).map(([key, value]) => (
                      <div key={key} className="pl-4">
                        {key}:{" "}
                        <span className="text-fd-foreground font-medium">
                          {typeof value === "string"
                            ? `'${value}'`
                            : String(value)}
                        </span>
                        ,
                      </div>
                    ))}
                    <div>{`}`}</div>
                  </div>
                </div>

                <div className="p-3 bg-red-950/10 border border-red-900/20 rounded-xl text-[11px] text-red-400/90 leading-relaxed font-sans">
                  <strong>Without a separate history:</strong>{" "}
                  {step >= 3
                    ? "Prior loan dates, fine assessments, and member book preferences have been overwritten. The history is reduced to 1 row."
                    : "This example keeps only the latest values. An audit table or another history mechanism would need to be added separately."}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-fd-muted-foreground p-6">
                <Database size={32} className="mb-3 opacity-20" />
                <p className="text-xs">No transactions executed yet.</p>
                <p className="text-[10px] text-fd-muted-foreground mt-1">
                  Click step 1 above to trigger the database state.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Alvyn Event Store */}
        <div className="flex flex-col h-[380px] lg:h-[460px] min-w-0 bg-fd-background text-left">
          <div className="px-5 py-3 border-b border-fd-border bg-fd-secondary/10 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-fd-foreground flex items-center gap-2">
              <Sparkles size={14} className="text-emerald-400" />
              Alvyn Event Store (Append-Only)
            </span>
            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Recorded events
            </span>
          </div>

          <div className="flex-1 p-5 overflow-auto space-y-3 font-mono text-xs select-none">
            {events.length > 0 ? (
              events.map((evt, idx) => (
                <div
                  key={evt.id}
                  className="bg-fd-secondary/20 border border-fd-border rounded-2xl p-4 transition-all duration-300 hover:border-emerald-500/40 relative overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                      #{idx + 1} — {evt.type}
                    </span>
                    <span className="text-[10px] text-fd-muted-foreground">
                      {evt.time}
                    </span>
                  </div>
                  <p className="text-[11px] font-sans text-fd-foreground mb-2 leading-relaxed">
                    {evt.desc}
                  </p>
                  <pre className="text-[10px] text-fd-muted-foreground bg-fd-background/80 p-2.5 rounded-xl overflow-x-auto border border-fd-border">
                    {JSON.stringify(evt.data, null, 2)}
                  </pre>
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center text-fd-muted-foreground p-6">
                <Sparkles size={32} className="mb-3 opacity-20" />
                <p className="text-xs">Event stream is empty.</p>
                <p className="text-[10px] text-fd-muted-foreground mt-1">
                  Click step 1 above to append your first CloudEvent.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Intelligence & Audit Insight Footer */}
      <div className="p-6 border-t border-fd-border bg-fd-secondary/10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-left">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mt-0.5">
            <Brain size={18} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-fd-foreground flex items-center gap-2">
              {ai.title}
            </h4>
            <p className="text-xs text-fd-muted-foreground mt-1 max-w-2xl leading-relaxed">
              {ai.text}
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className="text-[10px] font-mono px-3 py-1 rounded-full bg-fd-secondary border border-fd-border text-fd-secondary-foreground">
            {events.length} illustrative events
          </span>
        </div>
      </div>
    </div>
  );
}
