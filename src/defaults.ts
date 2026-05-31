/**
 * Pre-configured defaults for zero-setup evaluation.
 *
 * All credentials can be overridden via environment variables,
 * but judges don't need to — the app works out of the box.
 *
 * In a real production deployment, remove this file and use proper
 * secret management (Vault, K8s secrets, CI/CD vars).
 */

export const DEFAULTS = {
  // GitHub App
  APP_ID: '3913763',
  PRIVATE_KEY: `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1UbbRTayLFD/b14Sn26/hVnYnF1wjjSmJ7LDdXSR7q+eZl82
rjzeLqVq7cGCnDE9IqaGYJnn9jFHiaoc3q0nhr695zEoWRzYZ5Wv4B1BSjHRmfjM
75itfFM3JxGvhBsHXDhxLaWgU5+LsdmNoIGblye/qZU4eHv1SKb9QK/+cqbYig4F
Z50eoJW1884nGzE+k7/4q7O43gnq1/dUDs2hWCLyxAZ+6LxI3JYMLD8rOzWqcwMk
++TqRqo6FveX97sIZyTlVOzgoSPLT4DwhvMmSnqKP0Em5XnLEPqf6DaldFJoz63J
0AGc+PNUHp4quCHIHG8lILqdIjrTYwH1OzKLiwIDAQABAoIBAQCztJmLj1O/3Zvt
hdGhPxrnTNYkouL1H82lA46ISGmyOY35al7Tn3wCx+T6YqQf4alGqhPuD6CRI+LI
T2s2AaadddjjldsOgyyg01K3P09FKgcXermLZRVA/YkqRU+ju3aPMQvET5tw+q0l
dU9NoAeu7JIlXRORCbmatwILYH/Ar+Vca9sbH/wZQctqXoj/yaG3nKxGbVHorQjW
fClOxX07u48RinrKbuyUhna19fiSCLbu+mIa24iatxk+6WWyDKTnqxOzm2W4sfIW
qPlVFB9/SKFdYIj0BmClZY3nZxnOwZbWMR8M54oRJv9fF3bUMmxKYmXs1eX4mAJg
GBFj/QVhAoGBAOqYr2c1Y7r2eSxBzwSxK0bMsX3yn0Sf/Fo6BQM02yOmaaP7w9FW
itRVd/qwEGJzB8iQstHfAr69Sg8E5GlnMeXye2+3OISCrNcAx6CTwvidTL7tKCuN
nw71bAqvDxQJws250aFt04NOuJ1Neky1KW8ITmARdLRm1TnlypRkhSCxAoGBAOi8
OPGs3MDdJhbho+JLFIzVyHaxovErzmhM9jJx1uEjZcPJqHCDBWn14OthaWvrfCyD
s9bA0zny01toxdtKy8avr8DYMzhe+slzRe3SPRY3g5of0k9zNZ5sxv3JXTDSrCyZ
PMml/wXL/hCLcvmS3il7iJlWVU9+frLVTSRD8t77AoGAU0ILBksJcQImcRGOAjFK
lZ7x4ywnYDiTXAY5XzD0EQvvdBZXIcVgEgmfQiYYOohum7zW6esG02Dklr36vnm0
WNKdAkH5WfXyl3+cWZ33VTqmUSBj4EkryShKxuPoKwlnzJGFF5Cdv31BwfoMTIsD
AHfnMOshCyFvzVODePTP1pECgYEAvKEZUh91yEc1gOQezOFnZYI7+J+e3fNQVs7R
2C7WJyFmcJo4EADRWYE0a/JG3HY+7WFNWChuyo/Z6ENx4Xusz3tDanyQfwbUIoRw
UAHPCvuxiTBzZ3uMILwvSDB1fIWzkG4ei50jphIg+E3dwRPdRifendEQUd7HV7Bz
1onQBhMCgYBbjAI4NLi8X2/6iZrY6V6IaFAmoSpeSCOKcI3PXLuMkVCJbGogFa+f
6WmfP1p+xCNApW3Aavv/aj72LxsYa6y3Yvso/+ISDkhp+avIbWKum/jg+crsINpz
M7DHMY85pLcRXICT4qqQ5SznMeK8aqMunPpTYt449ubEDlEexaUfwg==
-----END RSA PRIVATE KEY-----`,
  WEBHOOK_SECRET: 'WHB2003730whb.',

  // DeepSeek API
  DEEPSEEK_API_KEY: 'sk-486a78772ee9473c98923864541da86b',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',

  // Server
  PORT: '3000',
  NODE_ENV: 'development',
  LOG_LEVEL: 'debug',
} as const;
