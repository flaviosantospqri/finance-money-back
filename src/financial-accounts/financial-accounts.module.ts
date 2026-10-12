import { Module } from '@nestjs/common';
import { FinancialAccountsController } from './financial-accounts.controller.js';
import { FinancialAccountsService } from './financial-accounts.service.js';

@Module({ controllers: [FinancialAccountsController], providers: [FinancialAccountsService], exports: [FinancialAccountsService] })
export class FinancialAccountsModule {}
