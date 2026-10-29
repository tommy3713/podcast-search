// Production is opted into explicitly (APP_ENV=production in deploy/compose.yml), so a
// local run can never act as the live site: no R2 backups, Telegram messages marked DEV.
export const isProduction = (): boolean => process.env.APP_ENV === 'production';
