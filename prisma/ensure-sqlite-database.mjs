import 'dotenv/config';

import { mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL?.trim();

if (databaseUrl === undefined || !databaseUrl.startsWith('file:')) {
  throw new Error('DATABASE_URL deve apontar para SQLite local.');
}

const databaseLocation = decodeURIComponent(databaseUrl.slice('file:'.length).split('?')[0] ?? '');

if (databaseLocation.length === 0) {
  throw new Error('DATABASE_URL deve informar o arquivo SQLite local.');
}

if (!databaseLocation.startsWith(':memory:')) {
  const databasePath = isAbsolute(databaseLocation)
    ? databaseLocation
    : resolve(process.cwd(), databaseLocation);

  await mkdir(dirname(databasePath), { recursive: true });
  const databaseFile = await open(databasePath, 'a');
  await databaseFile.close();
}
