import type { AccountBriefResponse, BriefItem, ChatResponse, ClaimCheckResponse, PublicSource } from '@deeproot/shared';

export type {
  Citation,
  MeetingReport,
  PublicSource,
  TicketDraft,
  TranscribeResponse,
  ChatResponse,
  ClaimCheckResponse,
  ReportResponse,
} from '@deeproot/shared';

/** Presentation data derived from AccountBriefResponse. Network shapes remain in shared. */
export type Brief = {
  accountId: string;
  accountName: string;
  brief: string;
  items: BriefItem[];
  openQuestions: string[];
  sources: PublicSource[];
};

export type ChatAnswer = ChatResponse;
export type ClaimCheck = ClaimCheckResponse;

export function toBrief(response: AccountBriefResponse): Brief {
  return {
    accountId: response.account.id,
    accountName: response.account.name,
    brief: response.brief.summary,
    items: response.brief.items,
    openQuestions: response.brief.openQuestions,
    sources: response.emails,
  };
}

export class ApiError extends Error {
  constructor(message: string, public status = 500, public fallbackUrl?: string) {
    super(message);
    this.name = 'ApiError';
  }
}
