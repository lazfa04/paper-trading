import cron from "node-cron";
import { recordPortfolioSnapshots } from "../services/portfolioSnapshot";

export function startSnapshotCron(): void {
  cron.schedule("0 * * * *", async () => {
    console.log("[cron] Recording portfolio snapshots…");
    try {
      await recordPortfolioSnapshots();
      console.log("[cron] Portfolio snapshots recorded.");
    } catch (err) {
      console.error("[cron] Portfolio snapshot job failed:", err);
    }
  });

  recordPortfolioSnapshots()
    .then(() => console.log("Initial portfolio snapshots recorded."))
    .catch((err) =>
      console.error("Initial portfolio snapshot failed:", err)
    );
}
