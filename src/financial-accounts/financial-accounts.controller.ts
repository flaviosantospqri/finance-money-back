import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CreateFinancialAccountDto, UpdateFinancialAccountDto } from './dto/financial-account.dto.js';
import { FinancialAccountsService } from './financial-accounts.service.js';

@Controller('financial-accounts')
export class FinancialAccountsController {
  constructor(private readonly accounts: FinancialAccountsService) {}

  @Get()
  findAll(@Query('active', new ParseBoolPipe({ optional: true })) active?: boolean) {
    return this.accounts.findAll(active);
  }

  @Post()
  create(@Body() input: CreateFinancialAccountDto) {
    return this.accounts.create(input);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateFinancialAccountDto) {
    return this.accounts.update(id, input);
  }
}
