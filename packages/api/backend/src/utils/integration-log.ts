import { prisma } from "./prisma";

type LogPayload = {
  userId: string;
  integrationId: string;
  userIntegrationId?: string | null;
  eventType: string;
  status: "success" | "failed";
  response?: unknown;
  errorMessage?: string | null;
};

export const logIntegrationEvent = async (payload: LogPayload) => {
  try {
    await prisma.integrationLog.create({
      data: {
        userId: payload.userId,
        integrationId: payload.integrationId,
        userIntegrationId: payload.userIntegrationId ?? null,
        eventType: payload.eventType,
        status: payload.status,
        response: payload.response ?? undefined,
        errorMessage: payload.errorMessage ?? undefined,
      },
    });
  } catch (error) {
    console.error("Failed to write integration log:", error);
  }
};
