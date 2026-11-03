"use client";

import { useState } from "react";
import { Sheet } from "@/components/learn/sheet";
import { sfx } from "@/components/learn/sfx";
import type { Ex } from "@/engine/ex";
import { t } from "@/i18n";
import { flush } from "./outbox";

const reasons = ["my_answer_ok", "answer_wrong", "audio", "translation", "other"] as const;
type Reason = (typeof reasons)[number];
type State = "idle" | "sending" | "sent" | "later" | "limit" | "failed";

/** The answer has to reach the server first; on a weak connection it is asked again a few times. */
const TRIES = 4;
const WAIT_MS = 1500;
const NOTE_MAX = 300;

/**
 * «گزارش اشکال» (PRD §13.10): one reason and, if the learner wants, one line. The answer itself and the
 * exercise are known to the server from the answer's id; a transform or translation is named by its text.
 */
export function ReportSheet({ open, onClose, answerId, ex, result }: { open: boolean; onClose: () => void; answerId: string | null; ex: Ex; result: string }) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>("idle");
  // «جواب من هم درست است» only means something after an answer that was not counted right.
  const shown = reasons.filter((item) => item !== "my_answer_ok" || result === "wrong" || result === "near");

  const send = async () => {
    if (!reason || !answerId) return;
    setState("sending");
    for (let attempt = 0; attempt < TRIES; attempt++) {
      await flush().catch(() => {});
      const response = await fetch("/api/learn/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answerId, reason, note: note.trim(), source: ex.q.source ?? null, promptFa: ex.q.promptFa ?? null }),
      }).catch(() => null);
      if (response?.ok) {
        sfx("success", 0.35);
        setState("sent");
        return;
      }
      if (response?.status === 429) return setState("limit");
      if (response && response.status !== 409) return setState("failed");
      await new Promise((resolve) => window.setTimeout(resolve, WAIT_MS));
    }
    setState("later");
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="report-title">
      <h2 id="report-title">{t("learn.report.title")}</h2>
      {state === "sent" ? (
        <>
          <p className="lead" role="status" data-report-sent>
            {t("learn.report.sent")}
          </p>
          <button type="button" className="primary" onClick={onClose}>
            {t("learn.session.continue")}
          </button>
        </>
      ) : (
        <>
          <p className="lead">{t("learn.report.lead")}</p>
          <div className="reasons" role="radiogroup" aria-label={t("learn.report.title")}>
            {shown.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={reason === item}
                className="reason"
                onClick={() => {
                  sfx("press", 0.3);
                  setReason(item);
                }}
              >
                {t(`learn.report.reasons.${item}`)}
              </button>
            ))}
          </div>
          <label className="field">
            <span>{t("learn.report.note")}</span>
            <input className="note-field" value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
          </label>
          {state === "later" || state === "limit" || state === "failed" ? (
            <p className="plan-problem" role="alert">
              {t(`learn.report.problem.${state}`)}
            </p>
          ) : null}
          <button type="button" className="primary" disabled={!reason || !answerId || state === "sending"} onClick={() => void send()}>
            {state === "sending" ? t("common.loading") : t("learn.report.send")}
          </button>
        </>
      )}
    </Sheet>
  );
}
