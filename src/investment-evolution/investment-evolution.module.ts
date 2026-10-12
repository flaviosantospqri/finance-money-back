import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InvestmentEvolutionController } from './investment-evolution.controller.js';
import { InvestmentEvolutionService } from './investment-evolution.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InvestmentEvolutionController],
  providers: [InvestmentEvolutionService],
})
export class InvestmentEvolutionModule {}
