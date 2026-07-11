import { ColorSchemeToggle } from '../components/ColorSchemeToggle/ColorSchemeToggle';
import { Welcome } from '../components/Welcome/Welcome';

import { db } from '../prisma/db';

export default async function HomePage() {
  const user = await db.orm.public.User
    .first();

  return (
    <>
      <Welcome />
      <ColorSchemeToggle /> 
      { `${user}` } 
      {user && (user.name)}    
    </>
  );
}
