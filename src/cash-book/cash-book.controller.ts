import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CashBookService } from './cash-book.service.js';
import { CashBookQueryDto } from './dto/cash-book-query.dto.js';
import { CashBookSummaryQueryDto } from './dto/cash-book-summary-query.dto.js';
import { CreateCashBookEntryDto } from './dto/create-cash-book-entry.dto.js';
import { UpdateCashBookEntryDto } from './dto/update-cash-book-entry.dto.js';

@Controller('cash-book')
export class CashBookController {
  constructor(private readonly cashBook: CashBookService) {}

  @Get('summary')
  summary(@Query() query: CashBookSummaryQueryDto) {
    return this.cashBook.summary(query.accountId, query.month);
  }

  @Get()
  findAll(@Query() filters: CashBookQueryDto) {
    return this.cashBook.findAll(filters);
  }

  @Post()
  create(@Body() input: CreateCashBookEntryDto) {
    return this.cashBook.create(input);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.cashBook.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateCashBookEntryDto) {
    return this.cashBook.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.cashBook.remove(id);
  }
}
