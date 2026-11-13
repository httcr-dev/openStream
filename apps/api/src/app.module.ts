import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { CatalogModule } from './catalog/catalog.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Funciona tanto rodando da raiz do monorepo quanto de apps/api
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
    }),
    CatalogModule,
    ProvidersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
