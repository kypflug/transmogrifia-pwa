/**
 * Auth Facade — thin delegation layer over the active auth provider.
 *
 * All auth logic now lives in provider implementations (e.g.
 * `providers/microsoft/auth.ts`). This module re-exports the same
 * public API surface so that consumers (`main.ts`, screens, services)
 * remain unchanged.
 */

import { getAuth, clearProviders } from './providers/registry';
import type { AuthRedirectResult, ProviderAccountInfo } from './providers/types';

// Re-export types for consumers
export type { AuthRedirectResult, ProviderAccountInfo };

// For backward compatibility with consumers expecting MSAL's AccountInfo,
// map ProviderAccountInfo to the same interface name
export type AccountInfo = ProviderAccountInfo;

export async function initAuth(force = false): Promise<AuthRedirectResult | null> {
  return getAuth().init(force);
}

export async function signIn(): Promise<ProviderAccountInfo | null> {
  return getAuth().signIn();
}

export async function signOut(): Promise<void> {
  await getAuth().signOut();
  clearProviders();
}

export async function getAccessToken(): Promise<string> {
  return getAuth().getAccessToken();
}

export function getAccount(): ProviderAccountInfo | null {
  return getAuth().getAccount();
}

export function isSignedIn(): boolean {
  return getAuth().isSignedIn();
}

export function getUserDisplayName(): string {
  return getAuth().getUserDisplayName();
}

export async function getUserId(): Promise<string | null> {
  return getAuth().getUserId();
}

export function clearCachedUserId(): void {
  return getAuth().clearCachedUserId();
}

export function hasAccountHint(): boolean {
  return getAuth().hasAccountHint();
}

export async function tryRecoverAuth(): Promise<boolean> {
  return getAuth().tryRecoverAuth();
}

export async function refreshTokenOnResume(): Promise<void> {
  return getAuth().refreshTokenOnResume();
}

export async function signInWithHint(): Promise<void> {
  return getAuth().signInWithHint();
}

export function setupBackgroundBackup(): void {
  getAuth().setupBackgroundBackup();
}
