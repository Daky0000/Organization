import { useCallback, useState } from "react";
import api from "../utils/api";

export type Integration = {
  id: string;
  name: string;
  slug: string;
  type: string;
  description?: string | null;
};

export type UserIntegration = {
  id: string;
  integrationId: string;
  accountId?: string | null;
  accountName?: string | null;
  accountEmail?: string | null;
  status?: string | null;
  tokenExpiry?: string | null;
  lastUsed?: string | null;
  createdAt?: string;
  integration?: Integration;
};

export type IntegrationLog = {
  id: string;
  eventType: string;
  status: string;
  createdAt: string;
  response?: any;
  errorMessage?: string | null;
};

type AuthUrlResponse = {
  authUrl: string;
  state?: string;
};

const getErrorMessage = (error: any) =>
  error?.response?.data?.error || error?.message || "Something went wrong";

export const useIntegrations = () => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [myIntegrations, setMyIntegrations] = useState<UserIntegration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (err: any) {
      const message = getErrorMessage(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getIntegrations = useCallback(
    async (type?: string) => {
      const data = await run(async () => {
        const response = await api.get<Integration[]>("/integrations", {
          params: type ? { type } : undefined,
        });
        return response.data;
      });
      setIntegrations(data);
      return data;
    },
    [run]
  );

  const getMyIntegrations = useCallback(async () => {
    const data = await run(async () => {
      const response = await api.get<UserIntegration[]>("/my-integrations");
      return response.data;
    });
    setMyIntegrations(data);
    return data;
  }, [run]);

  const getAuthUrl = useCallback(
    async (slug: string) => {
      return run(async () => {
        const response = await api.get<AuthUrlResponse>(
          `/integrations/${slug}/auth-url`
        );
        return response.data;
      });
    },
    [run]
  );

  const connectIntegration = useCallback(
    async (slug: string, code: string, codeVerifier?: string) => {
      return run(async () => {
        const response = await api.post(`/integrations/${slug}/callback`, {
          code,
          codeVerifier,
        });
        return response.data;
      });
    },
    [run]
  );

  const disconnectIntegration = useCallback(
    async (integrationId: string) => {
      return run(async () => {
        const response = await api.post(
          `/integrations/${integrationId}/disconnect`
        );
        return response.data;
      });
    },
    [run]
  );

  const getAccounts = useCallback(
    async (integrationId: string) => {
      return run(async () => {
        const response = await api.get<UserIntegration[]>(
          `/integrations/${integrationId}/accounts`
        );
        return response.data;
      });
    },
    [run]
  );

  const validateConnection = useCallback(
    async (integrationId: string) => {
      return run(async () => {
        const response = await api.post<{ valid: boolean; status?: string }>(
          `/integrations/${integrationId}/validate`
        );
        return response.data;
      });
    },
    [run]
  );

  const getLogs = useCallback(
    async (integrationId: string) => {
      return run(async () => {
        const response = await api.get<IntegrationLog[]>(
          `/integrations/logs/${integrationId}`
        );
        return response.data;
      });
    },
    [run]
  );

  return {
    integrations,
    myIntegrations,
    loading,
    error,
    selectedIntegration,
    setSelectedIntegration,
    getIntegrations,
    getMyIntegrations,
    getAuthUrl,
    connectIntegration,
    disconnectIntegration,
    getAccounts,
    validateConnection,
    getLogs,
  };
};

