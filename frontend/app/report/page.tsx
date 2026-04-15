import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";
import ReportForm from "./ReportForm";

export const metadata: Metadata = {
  title: "Report an Issue",
  description: "Report incorrect, outdated, or missing information on MarylandIQ.",
};

export default function ReportPage() {
  return (
    <main className="flex-1">
      <PageHeader
        title="Report an issue"
        subtitle="Help us keep candidate and race information accurate."
        breadcrumbs={[{ label: "Home", href: "/" }]}
      />

      <div className="bg-white flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <div className="text-sm text-[#475569] leading-relaxed space-y-3">
            <p>
              Found something wrong on a candidate or race page? Use this form to let us know.
              Reports are reviewed and corrections are applied directly to the database.
            </p>
            <p className="text-xs text-[#94a3b8]">
              Your email is optional but helps us follow up if we need more information.
            </p>
          </div>

          <ReportForm />
        </div>
      </div>
    </main>
  );
}
