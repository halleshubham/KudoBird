import { redirect } from "next/navigation";
import { currentSession } from "@/server/session";

export default async function Home() {
  redirect((await currentSession()) ? "/app" : "/login");
}
