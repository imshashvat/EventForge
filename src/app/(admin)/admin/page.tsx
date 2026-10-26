/**
 * /admin/page.tsx — Admin overview (redirects to events list)
 * The admin root just redirects to /admin/events which is the real dashboard.
 */
import { redirect } from "next/navigation";

export default function AdminPage() {
  redirect("/admin/events");
}
