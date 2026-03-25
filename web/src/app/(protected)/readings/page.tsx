import { redirect } from "next/navigation";

export default function ReadingsPage() {
  // Moisture readings live inside job detail (V2). Redirect to jobs.
  redirect("/jobs");
}
