import { Module } from '@nestjs/common';
import { FinancialCategoriesController } from './financial-categories.controller.js';
import { FinancialCategoriesService } from './financial-categories.service.js';

@Module({ controllers: [FinancialCategoriesController], providers: [FinancialCategoriesService], exports: [FinancialCategoriesService] })
export class FinancialCategoriesModule {}
