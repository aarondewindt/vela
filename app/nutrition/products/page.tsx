import { Alert, Container, Stack, Title } from '@mantine/core';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { ProductsView } from '@/components/Nutrition/ProductsView';

export default async function NutritionProductsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return (
      <Container size="lg" py="xl">
        <Stack>
          <Title order={2}>Food products</Title>
          <Alert color="yellow">
            Sign in using the navigation menu to manage your food products.
          </Alert>
        </Stack>
      </Container>
    );
  }
  return <ProductsView key={session.user.id} />;
}
