import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InvestmentsService } from './investments.service.js';
import {
  CreateInvestmentApplicationDto,
  CreateInvestmentTransactionDto,
  InvestmentQueryDto,
  UpdateInvestmentApplicationDto,
  UpdateInvestmentTransactionDto,
} from './dto/investment.dto.js';

@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investments: InvestmentsService) {}

  @Get('summary') summary(@Query() query: InvestmentQueryDto) {
    return this.investments.summary(query);
  }
  @Get() findAll(@Query('active') active?: string) {
    return this.investments.findAll(
      active === undefined ? undefined : active === 'true',
    );
  }
  @Post() create(@Body() input: CreateInvestmentApplicationDto) {
    return this.investments.create(input);
  }
  @Get(':id/transactions') transactions(
    @Param('id') id: string,
    @Query('month') month?: string,
  ) {
    return this.investments.transactions(id, month);
  }
  @Post(':id/transactions') createTransaction(
    @Param('id') id: string,
    @Body() input: CreateInvestmentTransactionDto,
  ) {
    return this.investments.createTransaction(id, input);
  }
  @Get(':id') findOne(@Param('id') id: string) {
    return this.investments.findOne(id);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body() input: UpdateInvestmentApplicationDto,
  ) {
    return this.investments.update(id, input);
  }
  @Delete(':id') removeApplication(@Param('id') id: string) {
    return this.investments.removeApplication(id);
  }
  @Patch('transactions/:id') updateTransaction(
    @Param('id') id: string,
    @Body() input: UpdateInvestmentTransactionDto,
  ) {
    return this.investments.updateTransaction(id, input);
  }
  @Delete('transactions/:id') removeTransaction(@Param('id') id: string) {
    return this.investments.removeTransaction(id);
  }
}
