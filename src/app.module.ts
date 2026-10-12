import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CashBookModule } from './cash-book/cash-book.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FinancialAccountsModule } from './financial-accounts/financial-accounts.module.js';
import { FinancialCategoriesModule } from './financial-categories/financial-categories.module.js';
import { TransfersModule } from './transfers/transfers.module.js';
import { FinancialForecastsModule } from './financial-forecasts/financial-forecasts.module.js';
import { InvestmentsModule } from './investments/investments.module.js';
import { InvestmentEvolutionModule } from './investment-evolution/investment-evolution.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CashBookModule,
    FinancialAccountsModule,
    FinancialCategoriesModule,
    TransfersModule,
    FinancialForecastsModule,
    InvestmentsModule,
    InvestmentEvolutionModule,
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'fllatech-money-api',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
