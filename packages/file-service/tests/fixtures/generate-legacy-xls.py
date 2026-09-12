"""Regenerate legacy-sales.xls with Python and xlwt==1.3.0 (test data only)."""

from datetime import datetime
from pathlib import Path
import struct

import xlwt

# xlwt leaves formula caches empty. Supply the known result without recalculating
# in the reader, as a saved Excel workbook would do.
original_formula_init = xlwt.BIFFRecords.FormulaRecord.__init__


def formula_with_cached_result(self, *args, **kwargs):
    original_formula_init(self, *args, **kwargs)
    self._rec_data = self._rec_data[:6] + struct.pack("<d", 58.5) + self._rec_data[14:]


xlwt.BIFFRecords.FormulaRecord.__init__ = formula_with_cached_result
workbook = xlwt.Workbook(encoding="utf-8")
sales = workbook.add_sheet("销售明细")
for column, name in enumerate(["商品", "数量", "单价", "金额", "日期"]):
    sales.write(0, column, name)
money = xlwt.easyxf(num_format_str="0.00")
sales.write(1, 0, "女士衬衫")
sales.write(1, 1, 3)
sales.write(1, 2, 19.5, money)
sales.write(1, 3, xlwt.Formula("B2*C2"), money)
sales.write(1, 4, datetime(2026, 9, 12), xlwt.easyxf(num_format_str="yyyy-mm-dd"))
summary = workbook.add_sheet("汇总")
summary.write(2, 1, 0)
summary.write(3, 1, False)
workbook.save(str(Path(__file__).with_name("legacy-sales.xls")))
