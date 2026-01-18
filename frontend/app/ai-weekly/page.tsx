import { redirect } from "next/navigation";

// AI Weekly has been replaced by the enhanced Discover page
export default function AIWeeklyPage() {
    redirect("/discover");
}
