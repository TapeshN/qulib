export interface OAuthProvider {
  id: string;
  label: string;
  patterns: RegExp[];
}

export const BUILT_IN_OAUTH_PROVIDERS: OAuthProvider[] = [
  { id: 'github', label: 'GitHub', patterns: [/\bgithub\b/i] },
  { id: 'google', label: 'Google', patterns: [/\bgoogle\b/i, /accounts\.google\.com/i] },
  { id: 'microsoft', label: 'Microsoft', patterns: [/microsoft/i, /login\.microsoftonline\.com/i] },
  { id: 'apple', label: 'Apple', patterns: [/sign in with apple/i, /\bapple id\b/i] },
  { id: 'facebook', label: 'Facebook', patterns: [/facebook/i] },
  { id: 'twitter', label: 'Twitter/X', patterns: [/twitter\.com/i, /\bsign in with x\b/i] },
  { id: 'linkedin', label: 'LinkedIn', patterns: [/linkedin/i] },

  { id: 'auth0', label: 'Auth0', patterns: [/auth0/i] },
  { id: 'okta', label: 'Okta', patterns: [/\bokta\b/i] },
  { id: 'onelogin', label: 'OneLogin', patterns: [/onelogin/i] },
  { id: 'duo', label: 'Duo Security', patterns: [/duo security/i] },
  { id: 'ping', label: 'Ping Identity', patterns: [/pingidentity/i, /pingone/i] },
  { id: 'workday', label: 'Workday', patterns: [/workday/i] },
  { id: 'saml', label: 'SAML SSO', patterns: [/\bsaml\b/i] },

  { id: 'clever', label: 'Clever', patterns: [/\bclever\b/i, /clever\.com/i] },
  { id: 'classlink', label: 'ClassLink', patterns: [/classlink/i] },
  { id: 'schoology', label: 'Schoology', patterns: [/schoology/i] },
  { id: 'canvas', label: 'Canvas (Instructure)', patterns: [/\bcanvas lms\b/i, /instructure/i] },
  { id: 'blackboard', label: 'Blackboard', patterns: [/blackboard/i] },
];
