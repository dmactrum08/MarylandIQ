"use client";

import { useState } from "react";

const ISSUE_TYPES = [
  { value: "wrong_info", label: "Wrong information" },
  { value: "outdated", label: "Outdated information" },
  { value: "missing", label: "Missing information" },
  { value: "other", label: "Other" },
];

export default function ReportForm({ defaultPageUrl }: { defaultPageUrl?: string }) {
  const [pageUrl, setPageUrl] = useState(defaultPageUrl ?? "");
  const [issueType, setIssueType] = useState("wrong_info");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_url: pageUrl || window.location.pathname,
          issue_type: issueType,
          description,
          reporter_email: email || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("success");
    } catch {
      setErrorMsg("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-2">
        <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-green-800">Report received — thank you.</p>
        <p className="text-xs text-green-700">We'll review it and apply corrections directly.</p>
        <a href="/" className="inline-block mt-2 text-xs text-[#CC0000] hover:underline">Back to home</a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Page URL */}
      <div>
        <label htmlFor="page_url" className="block text-xs font-medium text-[#475569] mb-1">
          Page with the issue <span className="text-[#94a3b8]">(e.g. /candidates/john-doe)</span>
        </label>
        <input
          id="page_url"
          type="text"
          value={pageUrl}
          onChange={(e) => setPageUrl(e.target.value)}
          placeholder="/candidates/john-doe"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent"
        />
      </div>

      {/* Issue type */}
      <div>
        <label htmlFor="issue_type" className="block text-xs font-medium text-[#475569] mb-1">
          Type of issue
        </label>
        <select
          id="issue_type"
          value={issueType}
          onChange={(e) => setIssueType(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent cursor-pointer"
        >
          {ISSUE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block text-xs font-medium text-[#475569] mb-1">
          Description <span className="text-[#CC0000]">*</span>
        </label>
        <textarea
          id="description"
          required
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what's wrong and what the correct information should be."
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent resize-none"
        />
        <p className="text-xs text-[#94a3b8] mt-1">{description.length}/2000</p>
      </div>

      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-xs font-medium text-[#475569] mb-1">
          Your email <span className="text-[#94a3b8]">(optional — for follow-up only)</span>
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-[#0F172A] placeholder-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:border-transparent"
        />
      </div>

      {errorMsg && (
        <p className="text-sm text-[#CC0000]" role="alert">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "loading" || description.trim().length === 0}
        className="w-full py-3 px-6 bg-[#CC0000] text-white text-sm font-semibold rounded-lg hover:bg-[#aa0000] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#CC0000] focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {status === "loading" ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}
