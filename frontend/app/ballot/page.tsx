import type { Metadata } from "next";
import { Suspense } from "react";
import BallotLookup from "./BallotLookup";

export const metadata: Metadata = {
  title: "Look Up My Ballot",
  description:
    "Enter your Maryland address to see every race on your 2026 ballot — school board, county council, sheriff, and more.",
};

export default function BallotPage() {
  return (
    <Suspense fallback={null}>
      <BallotLookup />
    </Suspense>
  );
}
