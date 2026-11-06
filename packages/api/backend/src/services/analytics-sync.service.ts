import { prisma } from "../utils/prisma";
import { AnalyticsService } from "./analytics.service";
import { logIntegrationEvent } from "../utils/integration-log";


export class AnalyticsSyncService {
  static async syncAllUserAnalytics(userId: string, agencyId: string) {
    const integrations = await prisma.userIntegration.findMany({
      where: { userId, user: { agencyId } },
      include: { integration: true },
    });

    for (const integration of integrations) {
      try {
        await AnalyticsService.fetchPlatformMetrics(
          integration.id,
          30,
          true
        );
        await logIntegrationEvent({
          userId,
          integrationId: integration.integrationId,
          userIntegrationId: integration.id,
          eventType: "analytics_sync",
          status: "success",
        });
      } catch (error: any) {
        await logIntegrationEvent({
          userId,
          integrationId: integration.integrationId,
          userIntegrationId: integration.id,
          eventType: "analytics_sync",
          status: "failed",
          errorMessage: error?.message || "Analytics sync failed",
        });
      }
    }
  }

  static async syncPlatformAnalytics(userIntegrationId: string) {
    const integration = await prisma.userIntegration.findUnique({
      where: { id: userIntegrationId },
    });
    if (!integration) throw new Error("Integration not found");

    await AnalyticsService.fetchPlatformMetrics(userIntegrationId, 30, true);
    await AnalyticsService.aggregateDailyMetrics(userIntegrationId, new Date());
  }

  static async aggregateAndStore(userIntegrationId: string, date: Date) {
    return AnalyticsService.aggregateDailyMetrics(userIntegrationId, date);
  }

  static async scheduleAutoSync() {
    // Scheduling handled by automation scheduler.
    return true;
  }
}
