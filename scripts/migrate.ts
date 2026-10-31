import { migrate } from '../src/db/migrate';
import { closePool } from '../src/db/pool';

const applied = await migrate((m) => console.log(m));
console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
await closePool();
