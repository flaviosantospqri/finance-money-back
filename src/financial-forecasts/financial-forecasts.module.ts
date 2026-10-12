import { Module } from '@nestjs/common';
import { FinancialForecastsController } from './financial-forecasts.controller.js';
import { FinancialForecastsService } from './financial-forecasts.service.js';
import { RepassesController } from './repasses.controller.js';
import { RepassesService } from './repasses.service.js';

@Module({
  controllers: [FinancialForecastsController, RepassesController],
  providers: [FinancialForecastsService, RepassesService],
})
export class FinancialForecastsModule {}
