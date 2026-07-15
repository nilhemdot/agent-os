export interface OAuthHeaderOptions {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  tokenKey: string;
  tokenSecret: string;
  bodyParams?: Record<string, string>;
}

export function percentEncode(str: string): string;
export function sortOAuthParams(params: Record<string, string>): Array<[string, string]>;
export function signatureBaseString(
  method: string,
  url: string,
  allParams: Record<string, string>
): string;
export function computeSignature(
  baseString: string,
  consumerSecret: string,
  tokenSecret: string
): string;
export function generateNonce(): string;
export function buildOAuthHeader(options: OAuthHeaderOptions): string;
export function extractUrls(text: string): Array<{
  url: string;
  start: number;
  end: number;
}>;
export function weightedLength(text: string): number;
export function chunkThread(text: string, maxChars?: number): string[];
