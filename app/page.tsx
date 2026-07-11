import { ColorSchemeToggle } from '../components/ColorSchemeToggle/ColorSchemeToggle';
import { Welcome } from '../components/Welcome/Welcome';

import { db } from '../prisma/db';

export default async function HomePage() {
  const user = await db.orm.User
  .where({ email: 'alice@example.com' })
  .first();

  return (
    <>
      <Welcome />
      <ColorSchemeToggle />      
    </>
  );
}
