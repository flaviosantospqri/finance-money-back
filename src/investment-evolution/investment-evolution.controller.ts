import { Controller, Get, Query } from '@nestjs/common';
import { InvestmentEvolutionQueryDto } from './dto/investment-evolution-query.dto.js';
import { InvestmentEvolutionService } from './investment-evolution.service.js';

@Controller('investment-evolution')
export class InvestmentEvolutionController {
  constructor(private readonly evolution: InvestmentEvolutionService) {}

  @Get('summary') summary(@Query() query: InvestmentEvolutionQueryDto) {
    return this.evolution.summary(query);
  }

  @Get('monthly') monthly(@Query() query: InvestmentEvolutionQueryDto) {
    return this.evolution.monthly(query);
  }

  @Get('history') history(@Query() query: InvestmentEvolutionQueryDto) {
    return this.evolution.monthly(query);
  }
}
