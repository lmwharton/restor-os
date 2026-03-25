import { redirect } from "next/navigation";

export default function TeamPage() {
  // Team management is now under Settings > Team tab.
  redirect("/settings");
}
