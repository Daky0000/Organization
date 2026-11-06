import { API_BASE_URL } from '../utils/apiBase';

function getToken() {
  return localStorage.getItem('auth_token') || '';
}
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}
async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; } catch { throw new Error(`Server error (${res.status})`); }
}

export type SurveyQuestion = {
  id: string;
  survey_id: string;
  type: 'radio' | 'checkbox' | 'rating' | 'nps' | 'text' | 'introduction' | 'range' | 'email' | 'contact' | 'content';
  question: string;
  options: string[];
  required: boolean;
  order_idx: number;
  settings: Record<string, unknown>;
};

export type Survey = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'active' | 'closed';
  thank_you_message: string;
  settings: Record<string, unknown>;
  questions?: SurveyQuestion[];
  response_count?: number;
  created_at: string;
  updated_at: string;
};

export type SurveyResponse = {
  id: string;
  survey_id: string;
  contact_id: string | null;
  respondent_email: string | null;
  answers: { question_id: string; value: unknown }[];
  ip_address: string | null;
  created_at: string;
};

export type QuestionAnalytics =
  | { type: 'radio' | 'checkbox'; counts: Record<string, number>; total: number }
  | { type: 'rating'; average: number; distribution: Record<string, number>; total: number }
  | { type: 'nps'; score: number; promoters: number; passives: number; detractors: number; total: number }
  | { type: 'text'; responses: string[]; total: number };

export type SurveyAnalytics = {
  total_responses: number;
  completion_rate: number;
  questions: Record<string, QuestionAnalytics>;
};

const BASE = `${API_BASE_URL}/api/surveys`;
const PUBLIC_BASE = `${API_BASE_URL}/api/public/surveys`;

export const surveysService = {
  async listSurveys(): Promise<Survey[]> {
    const res = await fetch(BASE, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; surveys: Survey[] }>(res);
    return data.surveys ?? [];
  },

  async createSurvey(payload: { title: string; description?: string; thank_you_message?: string }): Promise<Survey> {
    const res = await fetch(BASE, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; survey: Survey; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to create survey');
    return data.survey;
  },

  async getSurvey(id: string): Promise<Survey> {
    const res = await fetch(`${BASE}/${id}`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; survey: Survey; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Survey not found');
    return data.survey;
  },

  async updateSurvey(id: string, payload: Partial<Survey>): Promise<Survey> {
    const res = await fetch(`${BASE}/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; survey: Survey; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update survey');
    return data.survey;
  },

  async deleteSurvey(id: string): Promise<void> {
    await fetch(`${BASE}/${id}`, { method: 'DELETE', headers: authHeaders() });
  },

  async addQuestion(surveyId: string, payload: Omit<SurveyQuestion, 'id' | 'survey_id'>): Promise<SurveyQuestion> {
    const res = await fetch(`${BASE}/${surveyId}/questions`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; question: SurveyQuestion; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to add question');
    return data.question;
  },

  async updateQuestion(surveyId: string, questionId: string, payload: Partial<SurveyQuestion>): Promise<SurveyQuestion> {
    const res = await fetch(`${BASE}/${surveyId}/questions/${questionId}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; question: SurveyQuestion; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to update question');
    return data.question;
  },

  async deleteQuestion(surveyId: string, questionId: string): Promise<void> {
    await fetch(`${BASE}/${surveyId}/questions/${questionId}`, { method: 'DELETE', headers: authHeaders() });
  },

  async getResponses(surveyId: string): Promise<SurveyResponse[]> {
    const res = await fetch(`${BASE}/${surveyId}/responses`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean; responses: SurveyResponse[] }>(res);
    return data.responses ?? [];
  },

  async getAnalytics(surveyId: string): Promise<SurveyAnalytics> {
    const res = await fetch(`${BASE}/${surveyId}/analytics`, { headers: authHeaders() });
    const data = await parseJson<{ success: boolean } & SurveyAnalytics & { error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to load analytics');
    return { total_responses: data.total_responses, completion_rate: data.completion_rate, questions: data.questions };
  },

  // Public (no auth)
  async getPublicSurvey(id: string): Promise<Survey> {
    const res = await fetch(`${PUBLIC_BASE}/${id}`);
    const data = await parseJson<{ success: boolean; survey: Survey; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Survey not found');
    return data.survey;
  },

  async submitResponse(surveyId: string, payload: { respondent_email?: string; answers: { question_id: string; value: unknown }[] }): Promise<void> {
    const res = await fetch(`${PUBLIC_BASE}/${surveyId}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await parseJson<{ success: boolean; error?: string }>(res);
    if (!data.success) throw new Error(data.error || 'Failed to submit response');
  },
};
